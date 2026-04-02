/**
 * Durar AI — Session & Memory Manager
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SESSIONS_FILE, ensureDir } from "./config.js";

let sessions = {};

export function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) return;
  try {
    sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    sessions = {};
  }
}

export function saveSessions() {
  ensureDir();
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2) + "\n", "utf8");
}

export function getSession(id) {
  return sessions[id] ?? null;
}

export function getOrCreateSession(id, meta = {}) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      messages: [],
      createdAt: new Date().toISOString(),
      ...meta,
    };
  }
  return sessions[id];
}

export function appendMessage(sessionId, role, content) {
  const session = getOrCreateSession(sessionId);
  session.messages.push({ role, content, ts: new Date().toISOString() });
  // Keep last 100 messages per session
  if (session.messages.length > 100) session.messages = session.messages.slice(-100);
  session.updatedAt = new Date().toISOString();
  saveSessions();
  return session;
}

export function clearSession(id) {
  if (sessions[id]) sessions[id].messages = [];
  saveSessions();
}

export function listSessions() {
  return Object.values(sessions).map((s) => ({
    id: s.id,
    messages: s.messages.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

export function deleteSession(id) {
  delete sessions[id];
  saveSessions();
}
