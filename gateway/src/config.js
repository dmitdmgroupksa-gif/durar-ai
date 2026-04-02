/**
 * Durar AI — Configuration Manager
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const DURAR_DIR = join(homedir(), ".durar-ai");
export const CONFIG_FILE = join(DURAR_DIR, "config.json");
export const SESSIONS_FILE = join(DURAR_DIR, "sessions.json");

export const DEFAULTS = {
  gateway: {
    port: 3741,
    host: "127.0.0.1",
    token: null,
  },
  model: {
    provider: "ollama",
    name: "llama3.2",
    baseUrl: "http://127.0.0.1:11434",
  },
  persona: {
    name: "Durar",
    systemPrompt: "You are Durar, a helpful AI assistant powered by Durar AI. Be concise, accurate, and helpful.",
  },
};

export function ensureDir() {
  if (!existsSync(DURAR_DIR)) mkdirSync(DURAR_DIR, { recursive: true });
}

export function loadConfig() {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) return structuredClone(DEFAULTS);
  try {
    return { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(CONFIG_FILE, "utf8")) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(cfg) {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function generateToken() {
  return createHash("sha256").update(Math.random().toString() + Date.now()).digest("hex");
}
