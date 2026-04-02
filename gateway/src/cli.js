#!/usr/bin/env node
/**
 * Durar AI — CLI
 */
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { isOllamaRunning, listInstalledModels, listRunningModels, pullModelStream, POPULAR_MODELS } from "./ollama.js";
import { loadConfig, saveConfig, DURAR_DIR } from "./config.js";

const [,, cmd, ...args] = process.argv;

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, "..");
const HOME = homedir();
const IS_WIN = platform() === "win32";
const PID_FILE = join(HOME, ".durar-ai.pid");
const UPDATE_CACHE_FILE = join(DURAR_DIR, ".update-check");
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_BASE = "https://durar.ai";

// ─── Colours ──────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", gray: "\x1b[90m",
};
function ok(msg)    { process.stdout.write(`${C.green}  ✓${C.reset} ${msg}\n`); }
function info(msg)  { process.stdout.write(`${C.cyan}  →${C.reset} ${msg}\n`); }
function warn(msg)  { process.stdout.write(`${C.yellow}  ⚠${C.reset} ${msg}\n`); }
function err(msg)   { process.stderr.write(`${C.red}  ✗${C.reset} ${msg}\n`); }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatEta(seconds) {
  if (!seconds || seconds < 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch { return null; }
}

function writePid(pid) { writeFileSync(PID_FILE, String(pid)); }

function clearPid() { try { writeFileSync(PID_FILE, ""); } catch {} }

function isRunning(pid) {
  if (!pid) return false;
  try {
    if (IS_WIN) {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return output.includes(String(pid));
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch { return false; }
}

// ─── Update Checker ───────────────────────────────────────────────────────────
async function checkUpdate() {
  try {
    // Check cache
    if (existsSync(UPDATE_CACHE_FILE)) {
      const cached = JSON.parse(readFileSync(UPDATE_CACHE_FILE, "utf8"));
      if (Date.now() - cached.time < UPDATE_CHECK_INTERVAL) {
        if (cached.hasUpdate) {
          warn(`Update available! v${cached.local} → v${cached.remote}`);
          info(`Run: durar-ai update`);
        }
        return;
      }
    }

    // Fetch remote version
    const res = await fetch(`${DOWNLOAD_BASE}/version`);
    if (!res.ok) return;
    const data = await res.json();
    const remote = data.version;

    // Read local version
    const pkgPath = join(APP_DIR, "package.json");
    if (!existsSync(pkgPath)) return;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const local = pkg.version;

    // Compare
    const hasUpdate = remote !== local;

    // Cache result
    mkdirSync(DURAR_DIR, { recursive: true });
    writeFileSync(UPDATE_CACHE_FILE, JSON.stringify({ time: Date.now(), local, remote, hasUpdate }));

    if (hasUpdate) {
      warn(`Update available! v${local} → v${remote}`);
      info(`Run: durar-ai update`);
    }
  } catch {
    // Silently fail — update check is non-critical
  }
}

// ─── Update Command ───────────────────────────────────────────────────────────
async function cmdUpdate() {
  info("Checking for updates...");

  try {
    const res = await fetch(`${DOWNLOAD_BASE}/version`);
    if (!res.ok) { err("Could not reach update server"); process.exit(1); }
    const data = await res.json();
    const remote = data.version;

    const pkgPath = join(APP_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const local = pkg.version;

    if (remote === local) {
      ok(`Already on latest version (v${local})`);
      return;
    }

    info(`Found v${remote} (current: v${local})`);

    // Download ZIP
    const zipName = `durar-ai-node-${remote}.zip`;
    const zipUrl = `${DOWNLOAD_BASE}/releases/${zipName}`;
    const zipPath = join(HOME, ".durar-ai-update.zip");

    info("Downloading...");
    const dlRes = await fetch(zipUrl);
    if (!dlRes.ok) {
      err(`Download failed: HTTP ${dlRes.status}`);
      err(`Tried: ${zipUrl}`);
      process.exit(1);
    }
    const buf = await dlRes.arrayBuffer();
    writeFileSync(zipPath, Buffer.from(buf));

    // Extract
    info("Extracting...");
    const extractDir = join(HOME, ".durar-ai-update-extract");
    if (existsSync(extractDir)) rmSync(extractDir, { recursive: true });
    mkdirSync(extractDir, { recursive: true });

    // Use node's built-in zlib for ZIP extraction (simple approach)
    // For proper extraction, use the unzipper package or system tools
    if (IS_WIN) {
      try {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        err("Failed to extract ZIP");
        rmSync(zipPath, { force: true });
        rmSync(extractDir, { recursive: true });
        process.exit(1);
      }
    } else {
      try {
        execSync(`unzip -q -o '${zipPath}' -d '${extractDir}'`, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        err("Failed to extract ZIP");
        rmSync(zipPath, { force: true });
        rmSync(extractDir, { recursive: true });
        process.exit(1);
      }
    }

    // Flatten if nested
    const items = readdirSync(extractDir);
    let srcDir = extractDir;
    if (items.length === 1 && existsSync(join(extractDir, items[0])) && statSync(join(extractDir, items[0])).isDirectory()) {
      srcDir = join(extractDir, items[0]);
    }

    // Stop running gateway
    const pid = readPid();
    if (pid && isRunning(pid)) {
      info("Stopping running gateway...");
      try {
        if (IS_WIN) {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: ["pipe", "pipe", "pipe"] });
        } else {
          process.kill(pid, "SIGTERM");
        }
      } catch {}
    }

    // Replace app directory
    info("Installing...");
    if (existsSync(APP_DIR)) rmSync(APP_DIR, { recursive: true });
    renameSync(srcDir, APP_DIR);

    // Install dependencies
    info("Installing dependencies...");
    try {
      execSync(`npm install --omit=dev --silent`, { cwd: APP_DIR, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      warn("npm install had warnings (non-fatal)");
    }

    // Clear update cache
    try { rmSync(UPDATE_CACHE_FILE); } catch {}

    // Cleanup
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true });

    ok(`Updated to v${remote}`);

    // Auto-restart
    info("Restarting gateway...");
    setTimeout(() => cmdStart(), 1500);
  } catch (e) {
    err(`Update failed: ${e.message}`);
    process.exit(1);
  }
}

// ─── Start / Stop / Status ────────────────────────────────────────────────────
function cmdStart() {
  if (isRunning(readPid())) {
    warn("Durar AI is already running");
    info(`PID: ${readPid()}`);
    info("Run: durar-ai stop");
    return;
  }

  clearPid();
  info("Starting Durar AI...");

  const serverPath = join(APP_DIR, "src", "gateway.js");
  const child = spawn("node", [serverPath], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env },
  });

  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});

  child.on("error", (e) => {
    err(`Failed to start: ${e.message}`);
    clearPid();
    process.exit(1);
  });

  child.on("exit", (code) => {
    if (code !== 0) clearPid();
  });

  child.unref();
  writePid(child.pid);

  ok(`Durar AI started (PID ${child.pid})`);
  info("Logs: durar-ai logs");
  info("Stop:  durar-ai stop");
}

function cmdStop() {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    warn("Durar AI is not running");
    clearPid();
    return;
  }

  info(`Stopping Durar AI (PID ${pid})...`);
  try {
    if (IS_WIN) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: ["pipe", "pipe", "pipe"] });
    } else {
      process.kill(pid, "SIGTERM");
    }
    clearPid();
    ok("Durar AI stopped");
  } catch {
    clearPid();
    warn("Process may have already exited");
  }
}

function cmdStatus() {
  const pid = readPid();
  if (pid && isRunning(pid)) {
    ok(`Durar AI is running (PID ${pid})`);
  } else {
    warn("Durar AI is not running");
    if (pid) { info("Stale PID file found — cleaning up"); clearPid(); }
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────
async function health() {
  await checkUpdate();

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

// ─── Model Commands ───────────────────────────────────────────────────────────
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
    const etaStr = ev.eta ? ` · ${formatEta(ev.eta)} remaining` : "";
    const line = ev.percent !== undefined ? `  ${ev.status} ${ev.percent}%${etaStr}` : `  ${ev.status}`;
    if (line !== last) {
      process.stdout.write(`\r${line.padEnd(80)}`);
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

function help() {
  console.log(`
  ✨ Durar AI CLI

  COMMANDS:
    start                     Start the gateway server
    stop                      Stop the running gateway
    status                    Check if the gateway is running
    setup                     Run interactive setup wizard
    update                    Check and install updates
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
    durar-ai update
`);
}

// ─── Router ───────────────────────────────────────────────────────────────────
switch (cmd) {
  case "start":
    await checkUpdate();
    cmdStart();
    break;
  case "stop":
    cmdStop();
    break;
  case "status":
    cmdStatus();
    break;
  case "update":
    await cmdUpdate();
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
