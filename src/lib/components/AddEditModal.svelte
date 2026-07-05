<script lang="ts">
  import type { ProjectConfig, ProcessConfig } from "../types";
  import { saveProjects } from "../api";

  let {
    project,
    onClose,
  }: {
    project: ProjectConfig | null;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<ProjectConfig>(
    project
      ? structuredCloneToPlain(project)
      : blankProject(),
  );

  function structuredCloneToPlain(p: ProjectConfig): ProjectConfig {
    return JSON.parse(JSON.stringify(p));
  }

  function blankProject(): ProjectConfig {
    return {
      id: "",
      name: "",
      path: "",
      category: null,
      favicon: null,
      envFile: ".env",
      processes: [{ name: "dev", command: "", cwd: null, port: null, url: null, urlPattern: null, openOnStart: false }],
      ui: { pinned: false, logEnabled: false },
    };
  }

  function addProc() {
    draft.processes = [
      ...draft.processes,
      { name: "", command: "", cwd: null, port: null, url: null, urlPattern: null, openOnStart: false },
    ];
  }

  function removeProc(i: number) {
    draft.processes = draft.processes.filter((_, idx) => idx !== i);
  }

  function slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function save() {
    if (!draft.id) {
      draft.id = slugify(draft.name || draft.path.split("/").pop() || "project");
    }
    // Load current server-side list, merge this one, save.
    const res = await fetch("/api/projects");
    const cur: ProjectConfig[] = await res.json();
    let next: ProjectConfig[];
    const existingIdx = cur.findIndex((p) => p.id === draft.id);
    if (existingIdx >= 0) {
      next = [...cur];
      next[existingIdx] = draft;
    } else {
      next = [...cur, draft];
    }
    await saveProjects(next);
    onClose();
  }

  async function deleteProject() {
    if (!draft.id) return;
    if (!confirm(`Delete ${draft.name}? (Files on disk are not touched.)`)) return;
    const res = await fetch("/api/projects");
    const cur: ProjectConfig[] = await res.json();
    const next = cur.filter((p) => p.id !== draft.id);
    await saveProjects(next);
    onClose();
  }
</script>

<div
  class="modal-backdrop"
  role="button"
  tabindex="0"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
>
  <div class="modal">
    <div class="modal-head">
      <h3>{project ? "Edit project" : "Add project"}</h3>
      <button class="mini" onclick={onClose}>✕</button>
    </div>
    <div class="modal-body">
      <label class="fld">
        <span>Name</span>
        <input bind:value={draft.name} placeholder="My App" />
      </label>
      <label class="fld wide">
        <span>Path (absolute)</span>
        <input bind:value={draft.path} placeholder="/Users/…/myapp" />
      </label>
      <div class="fld-row">
        <label class="fld">
          <span>envFile</span>
          <input bind:value={draft.envFile} placeholder=".env" />
        </label>
        <label class="fld check">
          <input type="checkbox" bind:checked={draft.ui.pinned} />
          <span>Pinned</span>
        </label>
      </div>

      <h4>Processes</h4>
      {#each draft.processes as pr, i (i)}
        <div class="proc-edit">
          <input class="proc-edit-name" bind:value={pr.name} placeholder="name (dev)" />
          <input class="proc-edit-cmd" bind:value={pr.command} placeholder="command (bun run dev)" />
          <input class="proc-edit-cwd" bind:value={pr.cwd} placeholder="cwd (optional)" />
          <input class="proc-edit-port" type="number" bind:value={pr.port} placeholder="port" />
          <input class="proc-edit-url" bind:value={pr.url} placeholder="url override" />
          <label class="check">
            <input type="checkbox" bind:checked={pr.openOnStart} />
            <span>auto-open</span>
          </label>
          <button class="mini danger" onclick={() => removeProc(i)} disabled={draft.processes.length === 1}>✕</button>
        </div>
      {/each}
      <button class="add-proc" onclick={addProc}>+ add process</button>
    </div>
    <div class="modal-foot">
      {#if project}
        <button class="btn danger" onclick={deleteProject}>Delete</button>
      {/if}
      <span class="spacer"></span>
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn primary" onclick={save} disabled={!draft.name || !draft.path}>Save</button>
    </div>
  </div>
</div>