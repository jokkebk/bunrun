import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, openSync, writeSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PORT,
  HOST,
  REPO_ROOT,
  getProjects,
  findProject,
  saveProjects,
  startFileWatch,
  onChange,
  type ProjectsFile,
  type ProjectConfig,
} from "./config.js";
import {
  getVault,
  startVaultWatch,
  type VaultEntry,
  type VaultInput,
} from "./vault.js";
import { parseEnv, serializeEnv, type EnvLine } from "./envFile.js";
import {
  getState,
  getSnapshot,
  onStateChange,
  onLog,
  start,
  stop,
  restart,
  startAll,
  stopAll,
  stopAllRunners,
  syncFromConfig,
  makeKey,
  type ProcessState,
} from "./processManager.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = resolve(REPO_ROOT, "dist");

type FullState = {
  projects: ProjectConfig[];
  processes: ProcessState[];
};

let stateSnapshot: FullState = { projects: [], processes: [] };

function refresh(): void {
  stateSnapshot = { projects: getProjects(), processes: getState() };
  broadcastState();
}

function broadcastState(): void {
  const payload = JSON.stringify({ type: "state", data: stateSnapshot });
  for (const res of sseClients) {
    res.write(`event: state\ndata: ${payload}\n\n`);
  }
}

const sseClients = new Set<ServerResponse>();

function sendSnapshot(res: ServerResponse): void {
  res.write(
    `event: state\ndata: ${JSON.stringify({ type: "state", data: stateSnapshot })}\n\n`,
  );
}

function setSSE(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(": hello\n\n");
  sendSnapshot(res);
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

async function sendControl(
  req: IncomingMessage,
  res: ServerResponse,
  body: any,
): Promise<void> {
  try {
    const { action, projectId, procName } = body || {};
    if (action === "start") await start(projectId, procName);
    else if (action === "stop") await stop(projectId, procName);
    else if (action === "restart") await restart(projectId, procName);
    else if (action === "startAll") await startAll(projectId);
    else if (action === "stopAll") await stopAll(projectId);
    else return sendJSON(res, 400, { error: "unknown action" });
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    sendJSON(res, 400, { error: String(e) });
  }
}

function sendJSON(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

async function serveFavicon(
  projectId: string,
  res: ServerResponse,
): Promise<void> {
  const project = findProject(projectId);
  if (!project || !project.favicon) return sendText(res, 404, "not found");
  const base = resolve(project.path);
  const filePath = resolve(base, project.favicon);
  if (!filePath.startsWith(base + "/") && filePath !== base) {
    return sendText(res, 403, "forbidden");
  }
  if (!existsSync(filePath)) return sendText(res, 404, "not found");
  res.writeHead(200, { "Content-Type": mimeType(extname(filePath)) });
  const file = Bun.file(filePath);
  res.end(Buffer.from(await file.arrayBuffer()));
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!existsSync(DIST_DIR)) return false;
  let urlPath = req.url ?? "/";
  if (
    urlPath.startsWith("/api") ||
    urlPath.startsWith("/events") ||
    urlPath.startsWith("/fav/")
  )
    return false;
  let filePath = resolve(
    DIST_DIR,
    "." + (urlPath === "/" ? "/index.html" : urlPath),
  );
  if (!filePath.startsWith(DIST_DIR)) {
    sendText(res, 403, "forbidden");
    return true;
  }
  if (!existsSync(filePath)) {
    filePath = resolve(DIST_DIR, "index.html");
    if (!existsSync(filePath)) return false;
  }
  const mime = mimeType(extname(filePath));
  res.writeHead(200, { "Content-Type": mime });
  const file = Bun.file(filePath);
  res.end(Buffer.from(await file.arrayBuffer()));
  return true;
}

async function writeEnv(projectId: string, lines: EnvLine[]): Promise<void> {
  const project = findProject(projectId);
  if (!project) throw new Error("no project");
  const filePath = envFilePath(project);
  if (!filePath) throw new Error("no envFile configured");
  const out = serializeEnv(lines);
  await Bun.write(filePath, out);
}

async function promoteEnvKey(
  projectId: string,
  res: ServerResponse,
  body: any,
): Promise<void> {
  const key = String(body?.key ?? "");
  if (!key) return sendJSON(res, 400, { error: "key required" });
  const project = findProject(projectId);
  if (!project) return sendJSON(res, 404, { error: "no project" });
  const filePath = envFilePath(project);
  if (!filePath || !existsSync(filePath))
    return sendJSON(res, 404, { error: "no envFile" });
  const text = await Bun.file(filePath).text();
  const lines = parseEnv(text);
  const line = lines.find(
    (l) => l.kind === "kv" && l.key === key && !l.disabled,
  ) as Extract<EnvLine, { kind: "kv" }> | undefined;
  if (!line) return sendJSON(res, 404, { error: "key not found" });
  const entry = getVault().add(
    toVaultInput({
      label: body?.label ?? key,
      value: line.value,
      owner: body?.owner ?? null,
      provider: body?.provider ?? null,
      defaultVarName: body?.defaultVarName ?? key,
    }),
  );
  return sendJSON(res, 200, entry);
}

function mimeType(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
    case ".woff2":
      return `font/${ext.slice(1)}`;
    default:
      return "application/octet-stream";
  }
}

function readBody<T = any>(
  req: IncomingMessage,
  res: ServerResponse,
  cb: (body: T) => void | Promise<void>,
): void {
  let buf = "";
  req.on("data", (c) => (buf += c));
  req.on("end", () => {
    let body: any;
    try {
      body = buf === "" ? {} : JSON.parse(buf);
    } catch {
      sendJSON(res, 400, { error: "invalid JSON" });
      return;
    }
    Promise.resolve(cb(body as T)).catch((e) =>
      sendJSON(res, 500, { error: String(e) }),
    );
  });
}

function toVaultInput(body: any): VaultInput {
  return {
    label: String(body?.label ?? ""),
    value: String(body?.value ?? ""),
    owner: body?.owner ?? null,
    provider: body?.provider ?? null,
    defaultVarName: body?.defaultVarName ?? null,
  };
}

function envFilePath(project: ProjectConfig): string | null {
  if (!project.envFile) return null;
  const base = resolve(project.path);
  const filePath = resolve(base, project.envFile);
  if (!filePath.startsWith(base + "/") && filePath !== base) return null;
  return filePath;
}

async function serveEnvGet(
  projectId: string,
  res: ServerResponse,
): Promise<void> {
  const project = findProject(projectId);
  if (!project) return sendJSON(res, 404, { error: "no project" });
  const filePath = envFilePath(project);
  if (!filePath) return sendJSON(res, 404, { error: "no envFile configured" });
  if (!existsSync(filePath))
    return sendJSON(res, 404, { error: "env file missing" });
  try {
    const text = await Bun.file(filePath).text();
    const lines = parseEnv(text);
    return sendJSON(res, 200, { lines, vault: getVault().list() });
  } catch (e) {
    return sendJSON(res, 500, { error: String(e) });
  }
}

const handler = async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  if (url === "/events") {
    setSSE(res);
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
    res.on("close", () => clearInterval(keepAlive));
    return;
  }

  if (url.startsWith("/api/state")) return sendJSON(res, 200, stateSnapshot);
  if (url.startsWith("/api/logs/") && url.includes("/")) {
    const rest = url.slice("/api/logs/".length);
    const [projectId, procName] = rest.split("/");
    const key = makeKey(projectId, decodeURIComponent(procName));
    return sendJSON(res, 200, getSnapshot(key));
  }

  if (url === "/api/control" && req.method === "POST") {
    let bodyBuf = "";
    req.on("data", (c) => (bodyBuf += c));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(bodyBuf);
      } catch {}
      sendControl(req, res, body);
    });
    return;
  }

  if (url === "/api/vault" && req.method === "GET")
    return sendJSON(res, 200, getVault().list());

  if (url === "/api/vault" && req.method === "POST") {
    return readBody(req, res, async (body) => {
      try {
        const entry = getVault().add(toVaultInput(body));
        return sendJSON(res, 200, entry);
      } catch (e) {
        return sendJSON(res, 400, { error: String(e) });
      }
    });
  }

  if (
    url.startsWith("/api/vault/") &&
    (req.method === "PATCH" || req.method === "DELETE")
  ) {
    const id = decodeURIComponent(url.slice("/api/vault/".length));
    if (req.method === "DELETE") {
      const ok = getVault().remove(id);
      return sendJSON(res, ok ? 200 : 404, { ok });
    }
    return readBody(req, res, (body) => {
      const updated = getVault().update(id, toVaultInput(body));
      return sendJSON(
        res,
        updated ? 200 : 404,
        updated ?? { error: "not found" },
      );
    });
  }

  if (url === "/api/projects" && req.method === "GET")
    return sendJSON(res, 200, getProjects());

  if (url.startsWith("/fav/") && req.method === "GET") {
    const projectId = decodeURIComponent(url.slice("/fav/".length));
    return serveFavicon(projectId, res);
  }

  if (url === "/api/projects" && req.method === "PUT") {
    return readBody(req, res, (body) => {
      try {
        const projects = body as ProjectsFile;
        return saveProjects(projects).then(() =>
          sendJSON(res, 200, { ok: true }),
        );
      } catch (e) {
        return sendJSON(res, 400, { error: String(e) });
      }
    });
  }

  const envMatch = url.match(/^\/api\/projects\/([^/]+)\/env$/);
  if (envMatch) {
    const projectId = decodeURIComponent(envMatch[1]);
    if (req.method === "GET") return serveEnvGet(projectId, res);
    if (req.method === "PUT") {
      return readBody<EnvLine[]>(req, res, async (lines) => {
        try {
          await writeEnv(projectId, lines);
          return sendJSON(res, 200, { ok: true });
        } catch (e) {
          return sendJSON(res, 400, { error: String(e) });
        }
      });
    }
  }

  const promoteMatch = url.match(/^\/api\/projects\/([^/]+)\/env\/promote$/);
  if (promoteMatch && req.method === "POST") {
    const projectId = decodeURIComponent(promoteMatch[1]);
    return readBody(req, res, (body) => promoteEnvKey(projectId, res, body));
  }

  if (req.method === "GET" && (await serveStatic(req, res))) return;
  sendText(res, 404, "not found");
};

const server = createServer(handler);
server.listen(PORT, HOST, async () => {
  startFileWatch();
  startVaultWatch();
  syncFromConfig();
  onChange(() => {
    syncFromConfig();
    refresh();
  });
  onStateChange(() => refresh());
  onLog((key, line) => {
    const payload = JSON.stringify({ type: "log", data: { key, line } });
    for (const res of sseClients) {
      res.write(`event: log\ndata: ${payload}\n\n`);
    }
  });
  refresh();
  setTerminalTitle("🐰 bunrun");
  const isDev = process.env.BUNRUN_DEV === "1";
  const vitePort = process.env.VITE_PORT ?? String(Number(PORT) + 1);
  if (isDev) {
    console.log(
      `bunrun API on http://${HOST}:${PORT} — dashboard at http://localhost:${vitePort} (vite)`,
    );
  } else {
    const dashboard = `http://${HOST}:${PORT}`;
    console.log(`bunrun on ${dashboard}`);
    if (process.env.BUNRUN_NO_OPEN !== "1") openDashboard(dashboard);
  }
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nbunrun shutting down…");
  await stopAllRunners();
  server.close();
  setTerminalTitle("");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function setTerminalTitle(title: string): void {
  const seq = `\x1b]0;${title}\x07`;
  try {
    const fd = openSync("/dev/tty", "w");
    writeSync(fd, seq);
    closeSync(fd);
  } catch {
    if (process.stdout.isTTY) process.stdout.write(seq);
  }
}

function openDashboard(url: string): void {
  try {
    const cp = spawn("open", [url], { detached: true, stdio: "ignore" });
    cp.on("error", () => {});
    cp.unref();
  } catch {}
}

export {};
