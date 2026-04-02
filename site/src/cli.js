#!/usr/bin/env node
/**
 * Durar AI — Cross-Platform CLI
 * Works on Windows, macOS, and Linux.
 *
 * Commands:
 *   durar-ai start     — Start the gateway in the background
 *   durar-ai stop      — Stop the running gateway
 *   durar-ai status    — Check if the gateway is running
 *   durar-ai logs      — Tail the log file
 *   durar-ai restart   — Stop then start
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

// ── Paths ────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR   = join(__dirname, "..");
const HOME      = homedir();
const PID_FILE  = join(HOME, ".durar-ai.pid");
const LOG_FILE  = join(HOME, ".durar-ai", "logs.txt");
const IS_WIN    = platform() === "win32";

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  bold:   "\x1b[1m",
  gray:   "\x1b[90m",
};

function ok(msg)    { process.stdout.write(`${C.green}  ✓${C.reset} ${msg}\n`); }
function info(msg)  { process.stdout.write(`${C.cyan}  →${C.reset} ${msg}\n`); }
function warn(msg)  { process.stdout.write(`${C.yellow}  ⚠${C.reset} ${msg}\n`); }
function err(msg)   { process.stderr.write(`${C.red}  ✗${C.reset} ${msg}\n`); }
function banner()   { console.log(`\n${C.bold}  ✨ Durar AI${C.reset}\n`); }

// ── Helpers ──────────────────────────────────────────────────────────────────
function readPid() {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid) {
  writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  try { writeFileSync(PID_FILE, ""); } catch {}
}

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
  } catch {
    return false;
  }
}

function ensureLogDir() {
  const dir = dirname(LOG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(LOG_FILE, line);
}

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdStart() {
  banner();

  if (isRunning(readPid())) {
    warn("Durar AI is already running");
    info(`PID: ${readPid()}`);
    info("Run: durar-ai stop");
    return;
  }

  // Clear stale PID
  clearPid();

  info("Starting Durar AI...");

  const serverPath = join(APP_DIR, "app.js");
  const args = [serverPath];

  const child = spawn("node", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, DURAR_LOG_FILE: LOG_FILE },
  });

  // Pipe stdout/stderr to log file
  child.stdout?.on("data", (d) => {
    ensureLogDir();
    appendFileSync(LOG_FILE, d.toString());
  });

  child.stderr?.on("data", (d) => {
    ensureLogDir();
    appendFileSync(LOG_FILE, d.toString());
  });

  child.on("error", (e) => {
    err(`Failed to start: ${e.message}`);
    clearPid();
    process.exit(1);
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      log(`Process exited with code ${code}`);
    }
    clearPid();
  });

  // Detach so it survives the terminal closing
  child.unref();

  writePid(child.pid);
  log(`Started with PID ${child.pid}`);

  ok(`Durar AI started (PID ${child.pid})`);
  info("Logs: durar-ai logs");
  info("Stop:  durar-ai stop");
}

function cmdStop() {
  banner();

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
      // Brief wait for graceful shutdown
      const start = Date.now();
      while (isRunning(pid) && Date.now() - start < 5000) {
        // busy-wait
      }
      if (isRunning(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }

    clearPid();
    log(`Stopped PID ${pid}`);
    ok("Durar AI stopped");
  } catch (e) {
    clearPid();
    warn("Process may have already exited");
  }
}

function cmdStatus() {
  const pid = readPid();

  if (pid && isRunning(pid)) {
    banner();
    ok(`Durar AI is running (PID ${pid})`);
  } else {
    banner();
    warn("Durar AI is not running");
    if (pid) {
      info("Stale PID file found — cleaning up");
      clearPid();
    }
  }
}

function cmdLogs() {
  if (!existsSync(LOG_FILE)) {
    warn("No logs found yet");
    return;
  }

  const content = readFileSync(LOG_FILE, "utf8");
  const lines = content.split("\n").filter(Boolean);

  // Show last 100 lines
  const tail = lines.slice(-100);
  tail.forEach((line) => console.log(line));

  // If user wants to follow, we could add --follow later
}

function cmdRestart() {
  banner();
  info("Restarting Durar AI...");

  const pid = readPid();
  if (pid && isRunning(pid)) {
    info(`Stopping Durar AI (PID ${pid})...`);
    try {
      if (IS_WIN) {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: ["pipe", "pipe", "pipe"] });
      } else {
        process.kill(pid, "SIGTERM");
      }
      log(`Stopped PID ${pid}`);
      ok("Durar AI stopped");
    } catch {
      warn("Process may have already exited");
    }
  } else {
    warn("Durar AI was not running");
    clearPid();
  }

  // Brief pause then start
  const start = Date.now();
  while (Date.now() - start < 1500) {
    // busy-wait for port to free
  }
  cmdStart();
}

function cmdHelp() {
  banner();
  console.log("Usage: durar-ai <command>\n");
  console.log("Commands:");
  console.log(`  start      Start the gateway in the background`);
  console.log(`  stop       Stop the running gateway`);
  console.log(`  status     Check if the gateway is running`);
  console.log(`  logs       Show recent logs`);
  console.log(`  restart    Stop and start the gateway`);
  console.log(`  help       Show this help message\n`);
}

// ── Entry Point ──────────────────────────────────────────────────────────────
const command = process.argv[2] || "help";

switch (command) {
  case "start":
    cmdStart();
    break;
  case "stop":
    cmdStop();
    break;
  case "status":
    cmdStatus();
    break;
  case "logs":
    cmdLogs();
    break;
  case "restart":
    cmdRestart();
    break;
  case "help":
  case "--help":
  case "-h":
    cmdHelp();
    break;
  default:
    err(`Unknown command: ${command}`);
    console.log("");
    cmdHelp();
    process.exit(1);
}
