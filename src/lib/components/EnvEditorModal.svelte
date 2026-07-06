<script lang="ts">
  import type {
    EnvLine,
    EnvResponse,
    ProjectConfig,
    VaultEntry,
    VaultInput,
  } from "../types";

  let {
    project,
    onClose,
  }: {
    project: ProjectConfig;
    onClose: () => void;
  } = $props();

  let lines = $state<EnvLine[]>([]);
  let vault = $state<VaultEntry[]>([]);
  let vaultMap = $state<Map<string, VaultEntry>>(new Map());
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let saving = $state(false);

  let reveal: Record<string, boolean> = $state({});
  let pickerOpen = $state(false);
  let pickerQuery = $state("");
  let newVaultForm = $state(false);
  let newVaultDraft = $state<VaultInput>({
    label: "",
    value: "",
    owner: "",
    provider: "",
    defaultVarName: "",
  });

  async function load() {
    if (!project.envFile) {
      error = "This project has no envFile configured.";
      loaded = true;
      return;
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/env`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        error = j?.error ?? `HTTP ${res.status}`;
        loaded = true;
        return;
      }
      const data: EnvResponse = await res.json();
      lines = data.lines;
      vault = data.vault;
      rebuildMap();
    } catch (e) {
      error = String(e);
    }
    loaded = true;
  }

  function rebuildMap() {
    const m = new Map<string, VaultEntry>();
    for (const e of vault) if (!m.has(e.value)) m.set(e.value, e);
    vaultMap = m;
  }

  $effect(() => {
    load();
  });

  function maskify(s: string): string {
    return "•".repeat(Math.min(20, Math.max(4, s.length)));
  }

  function markDirty(l: Extract<EnvLine, { kind: "kv" }>) {
    l.rawValue = null;
  }

  function toggleReveal(key: string) {
    reveal[key] = !reveal[key];
  }

  function toggleDisabled(l: Extract<EnvLine, { kind: "kv" }>) {
    l.disabled = !l.disabled;
    l.rawValue = null;
  }

  function del(l: EnvLine, idx: number) {
    if (l.kind !== "kv") return;
    if (!confirm(`Delete ${l.key}?`)) return;
    lines.splice(idx, 1);
    lines = [...lines];
  }

  function rename(l: Extract<EnvLine, { kind: "kv" }>, newKey: string) {
    l.key = newKey;
    l.rawValue = null;
  }

  let newKeyDraft = $state({ name: "", value: "" });
  function addNewKey() {
    const name = newKeyDraft.name.trim().trim();
    if (!name) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      alert("Invalid key name; use A-Z, a-z, 0-9, _.");
      return;
    }
    addEnvInline({ key: name, value: newKeyDraft.value });
    newKeyDraft = { name: "", value: "" };
  }

  function addEnvInline(input: { key: string; value: string; disabled?: boolean }) {
    // Replace existing same-name line (active or disabled), else append.
    let found = false;
    for (const l of lines) {
      if (l.kind === "kv" && l.key === input.key) {
        l.value = input.value;
        l.rawValue = null;
        l.disabled = input.disabled ?? false;
        found = true;
        break;
      }
    }
    if (!found) {
      const nonBlank = lines.some((l) => l.kind !== "blank");
      const last = lines[lines.length - 1];
      if (nonBlank && last && last.kind !== "blank")
        lines.push({ kind: "blank", raw: "" });
      lines.push({
        kind: "kv",
        key: input.key,
        value: input.value,
        rawValue: null,
        disabled: input.disabled ?? false,
        exportPrefix: false,
        inlineComment: null,
        prefix: "",
      });
    }
    lines = [...lines];
  }

  async function insertFromVault(e: VaultEntry, varName: string) {
    const name = (varName || e.defaultVarName || e.label).trim();
    if (!name) {
      alert("Provide a variable name.");
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      alert("Invalid key name.");
      return;
    }
    addEnvInline({ key: name, value: e.value });
    pickerQuery = "";
    pickerOpen = false;
  }

  async function createVaultFromInlineForm() {
    if (!newVaultDraft.label || !newVaultDraft.value) {
      alert("Label and value required.");
      return;
    }
    const created = await vaultCreate(newVaultDraft);
    vault = [created, ...vault];
    rebuildMap();
    newVaultDraft = {
      label: "",
      value: "",
      owner: "",
      provider: "",
      defaultVarName: "",
    };
    newVaultForm = false;
  }

  async function vaultCreate(input: VaultInput): Promise<VaultEntry> {
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
    return await res.json();
  }

  async function promote(l: Extract<EnvLine, { kind: "kv" }>) {
    if (!l.key) return;
    const label = prompt(`Label for "${l.key}"`, l.key);
    if (!label) return;
    const res = await fetch(
      `/api/projects/${encodeURIComponent(project.id)}/env/promote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: l.key,
          label,
          owner: null,
          provider: null,
          defaultVarName: l.key,
        }),
      },
    );
    if (!res.ok) {
      alert("Promote failed.");
      return;
    }
    const entry: VaultEntry = await res.json();
    vault = [entry, ...vault.filter((v) => v.id !== entry.id)];
    rebuildMap();
  }

  async function save() {
    saving = true;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/env`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lines),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Save failed: ${j?.error ?? res.status}`);
        return;
      }
      onClose();
    } finally {
      saving = false;
    }
  }

  let grouped = $derived.by(() => {
    const q = pickerQuery.trim().toLowerCase();
    const filtered = vault.filter(
      (e) =>
        !q ||
        e.label.toLowerCase().includes(q) ||
        (e.provider ?? "").toLowerCase().includes(q) ||
        (e.owner ?? "").toLowerCase().includes(q) ||
        (e.defaultVarName ?? "").toLowerCase().includes(q),
    );
    const out = new Map<string, Map<string, VaultEntry[]>>();
    for (const e of filtered) {
      const owner = e.owner ?? "—";
      const provider = e.provider ?? "—";
      if (!out.has(owner)) out.set(owner, new Map());
      if (!out.get(owner)!.has(provider)) out.get(owner)!.set(provider, []);
      out.get(owner)!.get(provider)!.push(e);
    }
    return out;
  });
</script>

<div
  class="modal-backdrop"
  role="button"
  tabindex="0"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
>
  <div class="modal env-modal">
    <div class="modal-head">
      <h3>.env — {project.name}</h3>
      <button class="mini" onclick={onClose}>✕</button>
    </div>
    <div class="modal-body">
      {#if error}
        <div class="error">{error}</div>
      {:else if !loaded}
        <div>Loading…</div>
      {:else}
        <div class="env-list">
          {#each lines as l, i (i)}
            {#if l.kind === "kv"}
              {@const ve = vaultMap.get(l.value)}
              {@const known = Boolean(ve)}
              {@const revealed = reveal[l.key] ?? false}
              <div class="env-row" class:disabled={l.disabled}>
                <input
                  class="env-key"
                  value={l.key}
                  onchange={(e) => rename(l, (e.target as HTMLInputElement).value)}
                />
                <span class="env-eq">=</span>
                {#if ve && !revealed}
                  <span class="chip" title={ve.label}>{ve.label}</span>
                  <button class="mini" title="Reveal" onclick={() => (reveal[l.key] = true)}>👁</button>
                {:else}
                  <input
                    class="env-val"
                    type={revealed ? "text" : "password"}
                    value={l.value}
                    oninput={(e) => {
                      l.value = (e.target as HTMLInputElement).value;
                      markDirty(l);
                    }}
                  />
                  <button class="mini" title={revealed ? "Hide" : "Reveal"} onclick={() => toggleReveal(l.key)}>
                    {revealed ? "🙈" : "👁"}
                  </button>
                {/if}
                <button
                  class="mini"
                  title={l.disabled ? "Uncomment" : "Comment out"}
                  onclick={() => toggleDisabled(l)}
                >
                  {l.disabled ? "•" : "#"}
                </button>
                <button class="mini danger" title="Delete" onclick={() => del(l, i)}>✕</button>
                {#if !known && l.value}
                  <button class="mini" title="Promote to vault" onclick={() => promote(l)}>⇪</button>
                {/if}
              </div>
            {:else if l.kind === "blank"}
              <div class="env-blank">—</div>
            {:else if l.kind === "doc-comment"}
              <div class="env-doc" title={l.raw}>{l.raw}</div>
            {:else}
              <div class="env-doc" title={l.raw}>{l.raw}</div>
            {/if}
          {/each}
        </div>

        <div class="env-newkey">
          <input
            class="env-key"
            placeholder="NEW_KEY"
            bind:value={newKeyDraft.name}
          />
          <input
            class="env-val"
            type="password"
            placeholder="value"
            bind:value={newKeyDraft.value}
          />
          <button class="btn" onclick={addNewKey}>+ add</button>
        </div>

        <div class="vault-section">
          <div class="vault-head">
            <button class="mini" onclick={() => (pickerOpen = !pickerOpen)}>
              {pickerOpen ? "▾" : "▸"}
            </button>
            <span>Vault ({vault.length})</span>
            <button class="mini" onclick={() => (newVaultForm = !newVaultForm)}>
              {newVaultForm ? "cancel" : "+ new"}
            </button>
          </div>

          {#if newVaultForm}
            <div class="vault-form">
              <input placeholder="label" bind:value={newVaultDraft.label} />
              <input placeholder="value" type="password" bind:value={newVaultDraft.value} />
              <input placeholder="owner (corporate/personal)" bind:value={newVaultDraft.owner} />
              <input placeholder="provider (OpenAI…)" bind:value={newVaultDraft.provider} />
              <input placeholder="default var name" bind:value={newVaultDraft.defaultVarName} />
              <button class="btn" onclick={createVaultFromInlineForm}>Add</button>
            </div>
          {/if}

          {#if pickerOpen}
            <input
              class="vault-search"
              placeholder="search vault…"
              bind:value={pickerQuery}
            />
            <div class="vault-list">
              {#if vault.length === 0}
                <div class="vault-empty">No vault entries. Add one above or promote from the .env.</div>
              {:else if [...grouped.values()].every((m) => m.size === 0) || [...grouped.entries()].length === 0}
                <div class="vault-empty">No matches.</div>
              {:else}
                {#each [...grouped.entries()] as [owner, providers] (owner)}
                  <div class="vault-owner">{owner}</div>
                  {#each [...providers.entries()] as [provider, entries] (provider)}
                    {#each entries as e (e.id)}
                      <div class="vault-entry">
                        <span class="vault-label">{e.label}</span>
                        <span class="vault-meta">{provider}{e.defaultVarName ? ` · ${e.defaultVarName}` : ""}</span>
                        <label class="vault-row-inline">
                          <input
                            placeholder="var name"
                            value={e.defaultVarName ?? ""}
                            oninput={(ev) =>
                              (e.defaultVarName = (ev.target as HTMLInputElement).value)}
                          />
                          <button class="btn mini-row" onclick={() => insertFromVault(e, e.defaultVarName ?? "")}>
                            Insert
                          </button>
                        </label>
                      </div>
                    {/each}
                  {/each}
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <div class="modal-foot">
      <span class="spacer"></span>
      <button class="btn" onclick={onClose}>Close</button>
      {#if !error && loaded}
        <button class="btn primary" onclick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .env-modal {
    width: min(820px, 92vw);
  }
  .env-list {
    display: flex;
    flex-direction: column;
  }
  .env-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .env-row.disabled {
    opacity: 0.55;
  }
  .env-key {
    width: 170px;
    font-family: var(--mono, ui-monospace);
    font-size: 12px;
    background: var(--bg-elev2);
    color: var(--accent);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 6px;
  }
  .env-eq {
    color: var(--text-dim);
    font-family: var(--mono, ui-monospace);
    font-size: 12px;
  }
  .env-val {
    flex: 1;
    font-family: var(--mono, ui-monospace);
    font-size: 12px;
    background: var(--bg-elev2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 8px;
  }
  .chip {
    flex: 1;
    background: rgba(94, 158, 255, 0.12);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 10px;
    padding: 3px 14px;
    font-size: 12px;
    font-family: var(--mono, ui-monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .env-blank {
    opacity: 0.4;
    text-align: center;
    padding: 2px 0;
  }
  .env-doc {
    color: var(--text-dim);
    font-family: var(--mono, ui-monospace);
    font-size: 11.5px;
    white-space: pre-wrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 1px 6px;
    max-height: 3em;
  }
  .env-newkey {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--border);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .vault-section {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .vault-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .vault-form {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    margin-bottom: 10px;
  }
  .vault-form input {
    padding: 4px 8px;
    background: var(--bg-elev2);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
  }
  .vault-form .btn {
    grid-column: 3;
    justify-self: end;
  }
  .vault-search {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-elev2);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    margin-bottom: 8px;
  }
  .vault-list {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elev2);
  }
  .vault-owner {
    padding: 4px 10px;
    background: var(--bg-elev);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }
  .vault-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .vault-label {
    font-size: 12px;
    font-weight: 600;
  }
  .vault-meta {
    font-size: 11px;
    color: var(--text-dim);
    flex: 1;
  }
  .vault-row-inline {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .vault-row-inline input {
    width: 110px;
    font-family: var(--mono, ui-monospace);
    font-size: 11px;
    padding: 3px 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .mini-row {
    padding: 3px 10px;
    font-size: 11px;
  }
  .vault-empty {
    padding: 16px;
    color: var(--text-dim);
    font-size: 12px;
    text-align: center;
  }
  .error {
    color: var(--danger);
    font-size: 13px;
  }
</style>