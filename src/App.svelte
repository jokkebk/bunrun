<script lang="ts">
  import { onMount } from "svelte";
  import { connect, onLog, onState } from "./lib/sse";
  import { appendLog } from "./lib/stores";
  import { orderProjects } from "./lib/ordering";
  import type { FullState, ProjectConfig } from "./lib/types";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import MainPane from "./lib/components/MainPane.svelte";
  import AddEditModal from "./lib/components/AddEditModal.svelte";
  import EnvEditorModal from "./lib/components/EnvEditorModal.svelte";

  let appState = $state<FullState | null>(null);
  let selected = $state<string | null>(null);
  let search = $state("");
  let modalOpen = $state(false);
  let editTarget = $state<ProjectConfig | null>(null);
  let envModalProject = $state<ProjectConfig | null>(null);

  onMount(() => {
    connect();
    onState((s) => {
      appState = s;
      if (!selected && s.projects.length > 0) {
        selected = orderProjects(s.projects, s.processes)[0]?.id ?? null;
      }
    });
    onLog((key, line) => appendLog(key, line));
  });

  let filteredProjects = $derived.by(() => {
    if (!appState) return [];
    const ordered = orderProjects(appState.projects, appState.processes);
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q),
    );
  });

  let selectedProject = $derived(
    appState?.projects.find((p) => p.id === selected) ?? null,
  );
  let selectedProcesses = $derived(
    appState?.processes.filter((p) => p.projectId === selected) ?? [],
  );

  function onSelect(id: string) {
    selected = id;
  }
  function onEdit(p: ProjectConfig) {
    editTarget = p;
    modalOpen = true;
  }
  function onAdd() {
    editTarget = null;
    modalOpen = true;
  }
  function closeModal() {
    modalOpen = false;
    editTarget = null;
  }
  function onEnv(p: ProjectConfig) {
    envModalProject = p;
  }
  function closeEnvModal() {
    envModalProject = null;
  }
</script>

<div class="app">
  <Sidebar
    bind:search
    state={appState}
    {filteredProjects}
    {selected}
    {onSelect}
    {onEdit}
    {onAdd}
  />
  <MainPane project={selectedProject} processes={selectedProcesses} onEnv={onEnv} />
</div>
{#if modalOpen}
  <AddEditModal project={editTarget} onClose={closeModal} />
{/if}
{#if envModalProject}
  <EnvEditorModal project={envModalProject} onClose={closeEnvModal} />
{/if}