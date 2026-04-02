/**
 * Durar AI — cPanel Node.js Entry Point
 * cPanel requires the main file to be app.js and listen on process.env.PORT
 * Also works standalone via `durar-ai start` CLI command.
 */
import { createReadStream, statSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// cPanel injects PORT automatically — never hardcode it
const PORT = process.env.PORT || 3000;
const CURRENT_VERSION = "1.0.0";
const RELEASES_DIR = join(__dirname, "releases");

// ── File logging (when run via CLI) ──────────────────────────────────────────
const LOG_FILE = process.env.DURAR_LOG_FILE;
if (LOG_FILE) {
  const logDir = dirname(LOG_FILE);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => {
    const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
    appendFileSync(LOG_FILE, line);
    origLog(...args);
  };
  console.error = (...args) => {
    const line = `[${new Date().toISOString()}] ERROR ${args.join(" ")}\n`;
    appendFileSync(LOG_FILE, line);
    origErr(...args);
  };
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
let server;
function shutdown() {
  console.log("Shutting down...");
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.platform === "win32") {
  process.on("exit", shutdown);
}

// ── Logging ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ── install.sh ────────────────────────────────────────────────────────────────
app.get("/install.sh", (req, res) => {
  const file = join(__dirname, "install.sh");
  if (!existsSync(file)) return res.status(404).send("# Not found\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  createReadStream(file).pipe(res);
});

// ── install.ps1 ──────────────────────────────────────────────────────────────
app.get("/install.ps1", (req, res) => {
  const file = join(__dirname, "install.ps1");
  if (!existsSync(file)) return res.status(404).send("# Not found\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  createReadStream(file).pipe(res);
});

// ── Release downloads ─────────────────────────────────────────────────────────
app.get("/releases/:filename", (req, res) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9._-]+\.zip$/.test(filename)) return res.status(400).send("Invalid");
  const file = join(RELEASES_DIR, filename);
  if (!existsSync(file)) return res.status(404).json({ error: "Not found" });
  const { size } = statSync(file);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", size);
  createReadStream(file).pipe(res);
});

app.get("/download",       (req, res) => res.redirect(`/releases/durar-ai-node-${CURRENT_VERSION}.zip`));
app.get("/download/full",  (req, res) => res.redirect(`/releases/durar-ai-full-${CURRENT_VERSION}.zip`));
app.get("/version",        (req, res) => res.json({ version: CURRENT_VERSION }));

// ── Landing page ──────────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, "public")));
app.use((req, res) => res.status(404).send("Not found"));

server = app.listen(PORT, () => console.log(`Durar AI site running on port ${PORT}`));
