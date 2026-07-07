<script lang="ts">
  import type { ProjectConfig, ProcessState } from "../types";
  import LogRow from "./LogRow.svelte";

  let {
    project,
    processes,
  }: {
    project: ProjectConfig | null;
    processes: ProcessState[];
  } = $props();

  let focusedKey = $state<string | null>(null);

  // reset focus when project changes
  $effect(() => {
    const _ = project?.id;
    focusedKey = null;
  });
</script>

<main class="main">
  <div class="main-head">
    <h2 class="title">{project?.name ?? "No project selected"}</h2>
    {#if project}
      <span class="path" title={project.path}>{project.path}</span>
    {/if}
  </div>
  <div class="rows">
    {#if !project}
      <div class="placeholder">Select a project from the sidebar.</div>
    {:else if processes.length === 0}
      <div class="placeholder">No processes configured.</div>
    {:else}
      {#each processes as ps (ps.key)}
        <div
          class="row-wrap"
          class:focused={focusedKey === ps.key}
          class:dim={focusedKey !== null && focusedKey !== ps.key}
        >
          <LogRow
            {ps}
            focused={focusedKey === ps.key}
            onToggle={() => {
              focusedKey = focusedKey === ps.key ? null : ps.key;
            }}
          />
        </div>
      {/each}
    {/if}
  </div>
</main>