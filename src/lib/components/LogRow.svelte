<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ProcessState, LogLine } from "../types";
  import { subscribeLogs } from "../stores";
  import { call, fetchLogs } from "../api";
  import { renderAnsi } from "../ansi";
  import VirtualLog from "./VirtualLog.svelte";

  let {
    ps,
    focused,
    onToggle,
  }: {
    ps: ProcessState;
    focused: boolean;
    onToggle: () => void;
  } = $props();

  let lines = $state<LogLine[]>([]);
  let unsub: (() => void) | null = null;
  let hydrated = false;

  // re-subscribe when process key changes (restart → same key, but config might change)
  $effect(() => {
    const _ = ps.key;
    if (unsub) unsub();
    unsub = subscribeLogs(ps.key, (next) => {
      lines = next;
    });
    if (!hydrated) {
      hydrated = true;
      fetchLogs(ps.projectId, ps.procName).then((snap) => {
        if (snap && snap.length) lines = snap;
      });
    }
  });

  onDestroy(() => unsub?.());

  async function control(e: MouseEvent, action: "start" | "stop" | "restart") {
    e.stopPropagation();
    await call(action, ps.projectId, ps.procName);
  }

  let statusLabel = $derived(
    ps.status === "running"
      ? "running"
      : ps.status === "stopping"
        ? "stopping…"
        : ps.status === "crashed"
          ? `crashed${ps.exitCode != null ? ` (exit ${ps.exitCode})` : ""}`
          : "stopped",
  );
</script>

<section class="logrow" class:focused>
  <header
    class="row-head"
    role="button"
    tabindex="0"
    onclick={onToggle}
    onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
  >
    <span class="row-dot {ps.status}"></span>
    <span class="row-name">{ps.procName}</span>
    <span class="row-status {ps.status}">{statusLabel}</span>
    {#if ps.url}
      <a
        class="row-url"
        href={ps.url}
        target="_blank"
        rel="noreferrer"
        onclick={(e) => e.stopPropagation()}
      >{ps.url} ↗</a>
    {/if}
    <span class="row-cmd" title={ps.config.command}>{ps.config.command}</span>
    <span class="spacer"></span>
    {#if ps.status === "running" || ps.status === "stopping"}
      <button class="mini warn" title="Restart" onclick={(e) => control(e, "restart")}>↻</button>
      <button class="mini danger" title="Stop" onclick={(e) => control(e, "stop")} disabled={ps.status === "stopping"}>■</button>
    {:else}
      <button class="mini go" title="Start" onclick={(e) => control(e, "start")}>▶</button>
    {/if}
    <button class="mini" title={focused ? "Restore" : "Focus"} onclick={(e) => { e.stopPropagation(); onToggle(); }}>
      {focused ? "◧" : "⊟"}
    </button>
  </header>
  <div class="row-body">
    {#if ps.status === "stopped" && lines.length === 0}
      <div class="stopped-msg">
        Not running.
        <button class="go-btn" onclick={(e) => control(e, "start")}>▶ Start</button>
      </div>
    {:else}
      <VirtualLog {lines} idle={ps.status !== "running"} />
    {/if}
  </div>
</section>