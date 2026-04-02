/**
 * Durar AI — Gateway Server
 * HTTP + WebSocket API gateway with streaming, sessions, and Ollama support
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { loadConfig } from "./config.js";
import { streamChat } from "./providers.js";
import { loadSessions, getOrCreateSession, appendMessage, clearSession, listSessions, deleteSession } from "./sessions.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const cfg = loadConfig();
loadSessions();

const PORT = process.env.DURAR_AI_PORT ?? cfg.gateway?.port ?? 3741;
const HOST = process.env.DURAR_AI_HOST ?? cfg.gateway?.host ?? "127.0.0.1";
const TOKEN = process.env.DURAR_AI_GATEWAY_TOKEN ?? cfg.gateway?.token ?? null;

// ─── Auth middleware ──────────────────────────────────────────────────────────
function checkAuth(req) {
  if (!TOKEN) return true;
  const authHeader = req.headers["authorization"] ?? "";
  const tokenParam = new URL(req.url, `http://${req.headers.host}`).searchParams.get("token");
  return authHeader === `Bearer ${TOKEN}` || tokenParam === TOKEN;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(data);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (!checkAuth(req) && path !== "/health") {
    return json(res, 401, { error: "Unauthorized" });
  }

  try {
    // ── Health ──────────────────────────────────────────────────────────────
    if (path === "/health" && req.method === "GET") {
      return json(res, 200, {
        status: "ok",
        name: "Durar AI",
        version: "1.0.0",
        provider: cfg.model?.provider ?? "ollama",
        model: cfg.model?.name ?? "llama3.2",
      });
    }

    // ── Chat (streaming) ────────────────────────────────────────────────────
    if (path === "/v1/chat" && req.method === "POST") {
      const body = await readBody(req);
      const { message, session_id, stream = true } = body;
      if (!message) return json(res, 400, { error: "message required" });

      const sid = session_id ?? uuidv4();
      const session = getOrCreateSession(sid);
      appendMessage(sid, "user", message);

      const messages = session.messages.map((m) => ({ role: m.role, content: m.content }));

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(`data: ${JSON.stringify({ session_id: sid, type: "start" })}\n\n`);

        let fullText = "";
        try {
          for await (const chunk of streamChat(cfg, messages)) {
            fullText += chunk;
            res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
          }
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}\n\n`);
        }

        appendMessage(sid, "assistant", fullText);
        res.write(`data: ${JSON.stringify({ type: "done", session_id: sid })}\n\n`);
        res.end();
      } else {
        // Non-streaming
        let fullText = "";
        for await (const chunk of streamChat(cfg, messages)) fullText += chunk;
        appendMessage(sid, "assistant", fullText);
        return json(res, 200, { session_id: sid, message: fullText });
      }
      return;
    }

    // ── OpenAI-compatible endpoint ──────────────────────────────────────────
    if (path === "/v1/chat/completions" && req.method === "POST") {
      const body = await readBody(req);
      const { messages, stream = false } = body;
      if (!messages) return json(res, 400, { error: "messages required" });

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        for await (const chunk of streamChat(cfg, messages)) {
          const ev = { id: uuidv4(), object: "chat.completion.chunk", model: cfg.model?.name, choices: [{ delta: { content: chunk }, index: 0 }] };
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        let fullText = "";
        for await (const chunk of streamChat(cfg, messages)) fullText += chunk;
        return json(res, 200, {
          id: uuidv4(), object: "chat.completion", model: cfg.model?.name,
          choices: [{ message: { role: "assistant", content: fullText }, index: 0, finish_reason: "stop" }],
        });
      }
      return;
    }

    // ── Sessions ────────────────────────────────────────────────────────────
    if (path === "/v1/sessions" && req.method === "GET") {
      return json(res, 200, { sessions: listSessions() });
    }

    const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sid = sessionMatch[1];
      if (req.method === "GET") {
        const session = getOrCreateSession(sid);
        return json(res, 200, session);
      }
      if (req.method === "DELETE") {
        deleteSession(sid);
        return json(res, 200, { deleted: true });
      }
    }

    const clearMatch = path.match(/^\/v1\/sessions\/([^/]+)\/clear$/);
    if (clearMatch && req.method === "POST") {
      clearSession(clearMatch[1]);
      return json(res, 200, { cleared: true });
    }

    // ── Config info ─────────────────────────────────────────────────────────
    if (path === "/v1/config" && req.method === "GET") {
      return json(res, 200, {
        provider: cfg.model?.provider,
        model: cfg.model?.name,
        baseUrl: cfg.model?.baseUrl,
        persona: cfg.persona?.name,
      });
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

// ─── WebSocket ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  if (!checkAuth(req)) {
    ws.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
    ws.close();
    return;
  }

  const sid = uuidv4();
  ws.send(JSON.stringify({ type: "connected", session_id: sid, model: cfg.model?.name }));

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const { type, content, session_id } = msg;
    const activeSid = session_id ?? sid;

    if (type === "chat") {
      if (!content) return;
      appendMessage(activeSid, "user", content);
      const session = getOrCreateSession(activeSid);
      const messages = session.messages.map((m) => ({ role: m.role, content: m.content }));

      ws.send(JSON.stringify({ type: "start", session_id: activeSid }));
      let full = "";
      try {
        for await (const chunk of streamChat(cfg, messages)) {
          full += chunk;
          ws.send(JSON.stringify({ type: "chunk", content: chunk }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", error: e.message }));
        return;
      }
      appendMessage(activeSid, "assistant", full);
      ws.send(JSON.stringify({ type: "done", session_id: activeSid }));
    }

    if (type === "clear") clearSession(activeSid);
    if (type === "ping") ws.send(JSON.stringify({ type: "pong" }));
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`\n✨ Durar AI Gateway running`);
  console.log(`   HTTP   → http://${HOST}:${PORT}`);
  console.log(`   WS     → ws://${HOST}:${PORT}`);
  console.log(`   Model  → ${cfg.model?.provider ?? "ollama"}/${cfg.model?.name ?? "llama3.2"}`);
  if (TOKEN) console.log(`   Auth   → Bearer token enabled`);
  else console.log(`   Auth   → No token (add DURAR_AI_GATEWAY_TOKEN for security)`);
  console.log(``);
});
