<script lang="ts">
  import type { FullState, ProjectConfig, ProcessState } from "../types";
  import { call } from "../api";

  let {
    p,
    state,
    isselected,
    onSelect,
    onEdit,
  }: {
    p: ProjectConfig;
    state: FullState | null;
    isselected: boolean;
    onSelect: (id: string) => void;
    onEdit: (p: ProjectConfig) => void;
  } = $props();

  let processes = $derived(
    state?.processes.filter((ps) => ps.projectId === p.id) ?? [],
  );

  let anyRunning = $derived(
    processes.some((ps) => ps.status === "running" || ps.status === "stopping"),
  );
  let anyCrashed = $derived(processes.some((ps) => ps.status === "crashed"));

  let dotClass = $derived(
    anyCrashed
      ? "dot crashed"
      : anyRunning
        ? "dot running"
        : "dot stopped",
  );

  function initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase();
  }

  function colorFor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 55% 42%)`;
  }

  async function startAll(e: MouseEvent) {
    e.stopPropagation();
    await call("startAll", p.id);
  }
  async function control(
    e: MouseEvent,
    action: "start" | "stop" | "restart",
    procName: string,
  ) {
    e.stopPropagation();
    await call(action, p.id, procName);
  }

  function shortPath(path: string): string {
    const home = (window as any).__homePath ?? "";
    if (home && path.startsWith(home)) return "~" + path.slice(home.length);
    if (path.split("/").length > 4) {
      const parts = path.split("/");
      return "…/" + parts.slice(-3).join("/");
    }
    return path;
  }
</script>

<div
  class="card"
  class:active={isselected}
  role="button"
  tabindex="0"
  onclick={() => onSelect(p.id)}
  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }}
>
  <div class="card-row">
    <span
      class="chip"
      style={`background:${colorFor(p.name)}`}
      aria-hidden="true"
    >
      {initials(p.name)}
    </span>
    <span class="dot-wrap"><span class={dotClass}></span></span>
    <span class="name">{p.name}</span>
    <span class="spacer"></span>
    <button class="mini" title="Edit" onclick={(e) => { e.stopPropagation(); onEdit(p); }}>✎</button>
  </div>
  <div class="path" title={p.path}>{shortPath(p.path)}</div>
  <div class="procs">
    {#each processes as ps (ps.key)}
      <div class="proc">
        <span class="proc-name">{ps.procName}</span>
        <span class="proc-dot {ps.status}"></span>
        {#if ps.url}
          <a
            class="proc-url"
            href={ps.url}
            target="_blank"
            onclick={(e) => e.stopPropagation()}
            rel="noreferrer"
          >↗</a>
        {/if}
        <span class="spacer"></span>
        {#if ps.status === "running" || ps.status === "stopping"}
          <button
            class="mini warn"
            title="Restart"
            onclick={(e) => control(e, "restart", ps.procName)}
          >↻</button>
          <button
            class="mini danger"
            title="Stop"
            onclick={(e) => control(e, "stop", ps.procName)}
            disabled={ps.status === "stopping"}
          >■</button>
        {:else}
          <button
            class="mini go"
            title="Start"
            onclick={(e) => control(e, "start", ps.procName)}
          >▶</button>
        {/if}
      </div>
    {/each}
    <button class="startall" onclick={startAll} disabled={anyRunning}>
      Start all
    </button>
  </div>
</div>