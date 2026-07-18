import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..");
export const DATA_DIR = resolve(REPO_ROOT, "data");
export const PROJECTS_FILE = resolve(DATA_DIR, "projects.yaml");
export const PORT = Number(process.env.BUN_PORT ?? "3939");
export const HOST = "127.0.0.1";

export type ProcessConfig = {
  name: string;
  command: string;
  cwd: string | null;
  port: number | null;
  url: string | null;
  urlPattern: string | null;
  openOnStart: boolean;
};

export type ProjectUi = {
  pinned: boolean;
  logEnabled: boolean;
};

export type ProjectConfig = {
  id: string;
  name: string;
  path: string;
  category: string | null;
  favicon: string | null;
  envFile: string | null;
  processes: ProcessConfig[];
  ui: ProjectUi;
};

export type ProjectsFile = ProjectConfig[];

let cache: ProjectsFile = [];
let writeInProgressUntil = 0;
const listeners = new Set<() => void>();

export function getProjects(): ProjectsFile {
  return cache;
}

export function findProject(id: string): ProjectConfig | undefined {
  return cache.find((p) => p.id === id);
}

export async function loadProjects(): Promise<void> {
  if (!existsSync(PROJECTS_FILE)) {
    cache = [];
    return;
  }
  const text = await readFile(PROJECTS_FILE, "utf8");
  const data = parseProjectsYaml(text);
  if (data) {
    cache = sanitizeProjects(data);
    for (const l of listeners) l();
  }
}

export async function saveProjects(projects: ProjectsFile): Promise<void> {
  writeInProgressUntil = Date.now() + 1500;
  const yaml = (() => {
    if ((Bun as any).YAML?.stringify)
      return (Bun as any).YAML.stringify(projects);
    return serializeProjectsYaml(projects);
  })();
  await writeFile(PROJECTS_FILE, yaml, "utf8");
  cache = projects;
  for (const l of listeners) l();
}

// Merge a client-sent full list with what's on disk without dropping entries
// added concurrently by external writers (e.g. the bunrun admin skill writes
// the file atomically with tmp+rename, which macOS fs.watch routinely misses).
// The dashboard's GET /api/projects returns the in-memory cache, so the client
// is unaware of anything added between the watcher's last reload and the PUT.
// We preserve any on-disk id that neither the client nor the prior cache knew
// about; ids that were in the prior cache but missing from the client list are
// treated as intentional deletes.
export async function reconcileAndSaveProjects(
  incoming: ProjectsFile,
): Promise<ProjectsFile> {
  const cacheIds = new Set(cache.map((p) => p.id));
  await loadProjects();
  const incomingIds = new Set(incoming.map((p) => p.id));
  const preserved = cache.filter(
    (p) => !incomingIds.has(p.id) && !cacheIds.has(p.id),
  );
  const next = [...incoming, ...preserved];
  await saveProjects(next);
  return next;
}

export function onChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function startFileWatch(): void {
  loadProjects();
  let debounce: NodeJS.Timeout | null = null;
  if (!existsSync(PROJECTS_FILE)) return;
  let watcher;
  try {
    watcher = watch(PROJECTS_FILE, () => {
      if (Date.now() < writeInProgressUntil) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        loadProjects().catch((e) => console.error("reload error", e));
      }, 300);
    });
  } catch (e) {
    console.error("watch failed", e);
  }
  watcher?.on("error", () => {});
}

const defaultUi: ProjectUi = { pinned: false, logEnabled: false };

function sanitizeProjects(data: unknown): ProjectsFile {
  if (!Array.isArray(data)) return [];
  return (data as any[]).map((p) => ({
    id: String(p?.id ?? ""),
    name: String(p?.name ?? p?.id ?? ""),
    path: String(p?.path ?? ""),
    category: p?.category ?? null,
    favicon: p?.favicon ?? null,
    envFile: p?.envFile ?? null,
    processes: Array.isArray(p?.processes)
      ? p.processes.map((pr: any) => ({
          name: String(pr?.name ?? "dev"),
          command: String(pr?.command ?? ""),
          cwd: pr?.cwd ?? null,
          port: pr?.port ?? null,
          url: pr?.url ?? null,
          urlPattern: pr?.urlPattern ?? null,
          openOnStart: Boolean(pr?.openOnStart ?? false),
        }))
      : [],
    ui: { ...defaultUi, ...(p?.ui ?? {}) },
  }));
}

function parseProjectsYaml(text: string): unknown | null {
  if (text.trim() === "") return [];
  const data = (Bun as any).YAML?.parse
    ? (Bun as any).YAML.parse(text)
    : yamlParseLite(text);
  return data;
}

function yamlParseLite(text: string): unknown {
  const result: any[] = [];
  let cur: any = null;
  let curProc: any | null = null;
  let inProcesses = false;
  let inUi = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (indent === 0 && trimmed.startsWith("- ")) {
      cur = { ui: { ...defaultUi } };
      curProc = null;
      inProcesses = false;
      inUi = false;
      result.push(cur);
      applyLine(cur, trimmed.slice(2));
    } else if (trimmed.startsWith("processes:") && cur) {
      inProcesses = true;
      inUi = false;
      cur.processes = [];
    } else if (trimmed.startsWith("ui:") && cur) {
      inUi = true;
      inProcesses = false;
    } else if (inProcesses && cur) {
      curProc = curProc ?? {};
      if (trimmed.startsWith("- ")) {
        curProc = {};
        cur.processes.push(curProc);
        applyLine(curProc, trimmed.slice(2));
      } else {
        applyLine(curProc, trimmed);
      }
    } else if (inUi && cur) {
      applyLine(cur.ui, trimmed);
    } else if (cur && indent === 2) {
      applyLine(cur, trimmed);
    }
  }
  return result;
}

function applyLine(target: any, kv: string): void {
  if (kv.endsWith(":")) return;
  const m = kv.match(/^([a-zA-Z_]+):\s*(.*)$/);
  if (!m) return;
  const k = m[1];
  let v: any = m[2].trim();
  if (v === "" || v === "null") v = null;
  else if (v === "true") v = true;
  else if (v === "false") v = false;
  else if (/^-?\d+$/.test(v)) v = Number(v);
  else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  target[k] = v;
}

export function serializeProjectsYaml(projects: ProjectsFile): string {
  const lines: string[] = [];
  for (const p of projects) {
    lines.push(`- id: ${p.id}`);
    lines.push(`  name: ${p.name}`);
    lines.push(`  path: ${p.path}`);
    lines.push(`  category: ${p.category ?? "null"}`);
    lines.push(`  favicon: ${p.favicon ?? "null"}`);
    lines.push(`  envFile: ${p.envFile ?? "null"}`);
    lines.push(`  processes:`);
    for (const pr of p.processes) {
      lines.push(`    - name: ${pr.name}`);
      lines.push(`      command: ${pr.command}`);
      lines.push(`      cwd: ${pr.cwd ?? "null"}`);
      lines.push(`      port: ${pr.port ?? "null"}`);
      lines.push(`      url: ${pr.url ?? "null"}`);
      lines.push(`      urlPattern: ${pr.urlPattern ?? "null"}`);
      lines.push(`      openOnStart: ${pr.openOnStart}`);
    }
    lines.push(`  ui:`);
    lines.push(`    pinned: ${p.ui.pinned}`);
    lines.push(`    logEnabled: ${p.ui.logEnabled}`);
    lines.push("");
  }
  return lines.join("\n");
}
