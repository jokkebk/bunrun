import { readFile, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { randomId } from "./util.js";
import { DATA_DIR } from "./config.js";

const VAULT_FILE = resolve(DATA_DIR, "vault.yaml");

export type VaultEntry = {
  id: string;
  label: string;
  value: string;
  owner: string | null;
  provider: string | null;
  defaultVarName: string | null;
};

export type VaultInput = Omit<VaultEntry, "id">;

export interface Vault {
  list(): VaultEntry[];
  get(id: string): VaultEntry | undefined;
  findByValue(value: string): VaultEntry | null;
  add(input: VaultInput): VaultEntry;
  update(id: string, patch: Partial<VaultInput>): VaultEntry | undefined;
  remove(id: string): boolean;
}

let cache: VaultEntry[] = [];
let writeInProgressUntil = 0;

export function parseVaultYaml(text: string): VaultEntry[] {
  if (text.trim() === "") return [];
  const data = (Bun as any).YAML?.parse ? (Bun as any).YAML.parse(text) : null;
  if (!Array.isArray(data)) return [];
  return (data as any[])
    .map((e: any) => ({
      id: String(e?.id ?? randomId()),
      label: String(e?.label ?? ""),
      value: String(e?.value ?? ""),
      owner: e?.owner ?? null,
      provider: e?.provider ?? null,
      defaultVarName: e?.defaultVarName ?? null,
    }))
    .filter((e) => e.label !== "" && e.value !== "");
}

export function serializeVaultYaml(entries: VaultEntry[]): string {
  if ((Bun as any) && (Bun as any).YAML?.stringify)
    return (Bun as any).YAML.stringify(entries);
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`- id: ${e.id}`);
    lines.push(`  label: ${yamlScalar(e.label)}`);
    lines.push(`  value: ${yamlScalar(e.value)}`);
    lines.push(`  owner: ${e.owner === null ? "null" : yamlScalar(e.owner)}`);
    lines.push(
      `  provider: ${e.provider === null ? "null" : yamlScalar(e.provider)}`,
    );
    lines.push(
      `  defaultVarName: ${
        e.defaultVarName === null ? "null" : yamlScalar(e.defaultVarName)
      }`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

function yamlScalar(s: string): string {
  if (s === "") return '""';
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(s) || /^[ \-]/.test(s) || /[ ]$/.test(s))
    return JSON.stringify(s);
  return s;
}

async function load(): Promise<void> {
  if (!existsSync(VAULT_FILE)) {
    cache = [];
    return;
  }
  const text = await readFile(VAULT_FILE, "utf8");
  cache = parseVaultYaml(text);
}

async function persist(entries: VaultEntry[]): Promise<void> {
  writeInProgressUntil = Date.now() + 1500;
  if (!existsSync(DATA_DIR)) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(DATA_DIR, { recursive: true });
  }
  await writeFile(VAULT_FILE, serializeVaultYaml(entries), "utf8");
  cache = entries;
}

export function startVaultWatch(): void {
  load().catch((e) => console.error("vault load error", e));
  let debounce: NodeJS.Timeout | null = null;
  if (!existsSync(VAULT_FILE)) return;
  let watcher;
  try {
    watcher = watch(VAULT_FILE, () => {
      if (Date.now() < writeInProgressUntil) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        load().catch((e) => console.error("vault reload error", e));
      }, 300);
    });
  } catch (e) {
    console.error("vault watch failed", e);
  }
  watcher?.on("error", () => {});
}

export function getVault(): Vault {
  return {
    list() {
      return cache;
    },
    get(id) {
      return cache.find((e) => e.id === id);
    },
    findByValue(value) {
      return cache.find((e) => e.value === value) ?? null;
    },
    add(input) {
      const entry: VaultEntry = { id: randomId(), ...input };
      cache = [...cache, entry];
      persist(cache).catch((e) => console.error("vault persist error", e));
      return entry;
    },
    update(id, patch) {
      const idx = cache.findIndex((e) => e.id === id);
      if (idx < 0) return undefined;
      const updated = { ...cache[idx], ...patch, id };
      const next = [...cache];
      next[idx] = updated;
      cache = next;
      persist(cache).catch((e) => console.error("vault persist error", e));
      return updated;
    },
    remove(id) {
      const before = cache.length;
      cache = cache.filter((e) => e.id !== id);
      const removed = cache.length < before;
      if (removed)
        persist(cache).catch((e) => console.error("vault persist error", e));
      return removed;
    },
  };
}
