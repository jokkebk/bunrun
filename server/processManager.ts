import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import {
  createRingBuffer,
  pushLine,
  snapshot,
  type RingBuffer,
  type LogLine,
} from "./ringBuffer.js";
import { scrapeUrl, openUrl } from "./urlScraper.js";
import {
  findProject,
  getProjects,
  type ProcessConfig,
  type ProjectConfig,
} from "./config.js";

const GRACE_MS = 4000;

export type ProcessKey = string; // `${projectId}/${procName}`

export type ProcessState = {
  key: ProcessKey;
  projectId: string;
  procName: string;
  status: "stopped" | "running" | "stopping" | "crashed";
  pid: number | null;
  pgid: number | null;
  exitCode: number | null;
  url: string | null;
  opened: boolean;
  config: ProcessConfig;
};

type Managed = {
  state: ProcessState;
  cp: ChildProcess | null;
  pgid: number | null;
  buf: RingBuffer;
  scrapeUntil: number | null; // ms timestamp ceiling for url scraping
  scrapeTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
};

const managed = new Map<ProcessKey, Managed>();
const ee = new EventEmitter();

export function getState(): ProcessState[] {
  return Array.from(managed.values()).map((m) => ({ ...m.state }));
}

export function onStateChange(cb: () => void): () => void {
  ee.on("state", cb);
  return () => ee.off("state", cb);
}

export function onLog(
  cb: (key: ProcessKey, line: LogLine) => void,
): () => void {
  ee.on("log", cb);
  return () => ee.off("log", cb);
}

export function getSnapshot(key: ProcessKey): LogLine[] {
  const m = managed.get(key);
  return m ? snapshot(m.buf) : [];
}

export function syncFromConfig(): void {
  // Remove managed entries whose project/proc no longer exist; keep buffer/state.
  // New projects/processes are registered lazily on start, but we pre-create them
  // so the UI shows rows for all configured processes.
  const seen = new Set<ProcessKey>();
  for (const p of getProjects()) {
    for (const pr of p.processes) {
      const key = makeKey(p.id, pr.name);
      seen.add(key);
      if (!managed.has(key)) {
        managed.set(key, makeManaged(p.id, pr));
      } else {
        const m = managed.get(key)!;
        m.state.config = pr;
      }
    }
  }
  for (const [key, m] of managed) {
    if (!seen.has(key) && m.state.status !== "running") managed.delete(key);
  }
  emitState();
}

export function makeKey(projectId: string, procName: string): ProcessKey {
  return `${projectId}/${procName}`;
}

export async function start(
  projectId: string,
  procName: string,
): Promise<void> {
  const project = findProject(projectId);
  if (!project) throw new Error(`unknown project ${projectId}`);
  const pr = project.processes.find((p) => p.name === procName);
  if (!pr) throw new Error(`unknown process ${procName}`);
  const key = makeKey(projectId, procName);
  let m = managed.get(key);
  if (m && m.state.status === "running") return;
  if (m && m.killTimer) {
    clearTimeout(m.killTimer);
    m.killTimer = null;
  }
  if (!m) {
    m = makeManaged(projectId, pr);
    managed.set(key, m);
  } else {
    m.state.config = pr;
  }
  const cwd = pr.cwd ? resolve(project.path, pr.cwd) : project.path;
  const cp = spawn("sh", ["-c", pr.command], {
    cwd,
    env: { ...process.env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  m.cp = cp;
  m.state.status = "running";
  m.state.exitCode = null;
  m.state.url = null;
  m.state.opened = false;
  m.state.pgid = typeof cp.pid === "number" ? cp.pid : null;
  m.state.pid = cp.pid ?? null;
  m.scrapeUntil = Date.now() + 10_000;
  if (m.scrapeTimer) clearTimeout(m.scrapeTimer);
  m.scrapeTimer = setTimeout(() => {
    m.scrapeUntil = null;
  }, 10_000);
  // Declared explicit url: known immediately, no need to wait for stdout.
  const declared = pr.url?.trim() || null;
  if (declared) {
    m.state.url = declared;
    if (pr.openOnStart && !m.state.opened) {
      m.state.opened = true;
      openUrl(declared).then(
        () => console.log(`[auto-open] ${m.state.key} -> ${declared}`),
        () => {},
      );
    }
  }
  emitState();

  cp.stdout?.on("data", (b: Buffer) =>
    handleOutput(m!, "stdout", b.toString("utf8")),
  );
  cp.stderr?.on("data", (b: Buffer) =>
    handleOutput(m!, "stderr", b.toString("utf8")),
  );
  cp.on("exit", (code, signal) => {
    if (m!.killTimer) {
      clearTimeout(m!.killTimer);
      m!.killTimer = null;
    }
    if (m!.scrapeTimer) {
      clearTimeout(m!.scrapeTimer);
      m!.scrapeTimer = null;
    }
    const crashed = m!.state.status === "running";
    m!.state.status = code === 0 || !crashed ? "stopped" : "crashed";
    m!.state.exitCode = code ?? (signal ? -1 : null);
    m!.state.pid = null;
    m!.state.pgid = null;
    m!.cp = null;
    m!.scrapeUntil = null;
    emitState();
  });
}

export async function stop(projectId: string, procName: string): Promise<void> {
  const key = makeKey(projectId, procName);
  const m = managed.get(key);
  if (!m || !m.cp || m.state.status !== "running") return;
  m.state.status = "stopping";
  emitState();
  await stopManaged(m);
}

export async function restart(
  projectId: string,
  procName: string,
): Promise<void> {
  const key = makeKey(projectId, procName);
  const m = managed.get(key);
  if (m && m.state.status === "running") {
    await stopManaged(m);
  }
  await start(projectId, procName);
}

export async function startAll(projectId: string): Promise<void> {
  const project = findProject(projectId);
  if (!project) return;
  for (const pr of project.processes) {
    try {
      await start(projectId, pr.name);
    } catch (e) {
      console.error(`start ${projectId}/${pr.name} failed`, e);
    }
  }
}

export async function stopAllRunners(): Promise<void> {
  const running = Array.from(managed.values()).filter(
    (m) => m.state.status === "running" || m.state.status === "stopping",
  );
  await Promise.all(running.map((m) => stopManaged(m)));
}

function makeManaged(projectId: string, pr: ProcessConfig): Managed {
  const key = makeKey(projectId, pr.name);
  return {
    state: {
      key,
      projectId,
      procName: pr.name,
      status: "stopped",
      pid: null,
      pgid: null,
      exitCode: null,
      url: null,
      opened: false,
      config: pr,
    },
    cp: null,
    pgid: null,
    buf: createRingBuffer(),
    scrapeUntil: null,
    scrapeTimer: null,
    killTimer: null,
  };
}

async function stopManaged(m: Managed): Promise<void> {
  if (!m.cp) return;
  const cp = m.cp;
  const pgid = m.state.pgid;
  try {
    if (pgid != null) process.kill(-pgid, "SIGTERM");
    else cp.kill("SIGTERM");
  } catch {
    try {
      cp.kill("SIGTERM");
    } catch {}
  }
  await new Promise<void>((resolveStop) => {
    const done = () => resolveStop();
    cp.once("exit", done);
    m.killTimer = setTimeout(() => {
      try {
        if (pgid != null) process.kill(-pgid, "SIGKILL");
        else cp.kill("SIGKILL");
      } catch {
        try {
          cp.kill("SIGKILL");
        } catch {}
      }
      resolveStop();
    }, GRACE_MS);
  });
}

function handleOutput(
  m: Managed,
  stream: "stdout" | "stderr",
  text: string,
): void {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    const ll: LogLine = { ts: Date.now(), stream, line };
    if (m.scrapeUntil && !m.state.url) {
      const url = scrapeUrl(m.state.config, line);
      if (url) {
        m.state.url = url;
        emitState();
        if (m.state.config.openOnStart && !m.state.opened) {
          m.state.opened = true;
          openUrl(url).then(
            () => console.log(`[auto-open] ${m.state.key} -> ${url}`),
            () => {},
          );
        }
      }
    }
    pushLine(m.buf, ll);
    ee.emit("log", m.state.key, ll);
  }
}

function emitState(): void {
  ee.emit("state");
}
