<script lang="ts">
  import type { FullState, ProjectConfig } from "../types";
  import { shutdown } from "../api";
  import ProjectCard from "./ProjectCard.svelte";

  let {
    search = $bindable(""),
    state,
    filteredProjects,
    selected,
    onSelect,
    onEdit,
    onAdd,
  }: {
    search: string;
    state: FullState | null;
    filteredProjects: ProjectConfig[];
    selected: string | null;
    onSelect: (id: string) => void;
    onEdit: (p: ProjectConfig) => void;
    onAdd: () => void;
  } = $props();

  async function onShutdown() {
    if (!confirm("Shut down bunrun? This will stop all running projects.")) return;
    try {
      await shutdown();
    } catch (e) {
      alert(`Shutdown failed: ${e}`);
    }
  }
</script>

<aside class="sidebar">
  <div class="sidebar-head">
    <input class="search" type="text" placeholder="Search name or path…" bind:value={search} />
    <button class="add-btn" title="Add project" onclick={onAdd}>+</button>
    <button class="add-btn power-btn" title="Shut down bunrun" onclick={onShutdown}>⏻</button>
  </div>
  <div class="cards">
    {#each filteredProjects as p (p.id)}
      <ProjectCard
        {p}
        {state}
        isselected={selected === p.id}
        {onSelect}
        {onEdit}
      />
    {/each}
    {#if filteredProjects.length === 0}
      <div class="empty">No projects{state?.projects.length ? " match" : " configured"}.</div>
    {/if}
  </div>
</aside>