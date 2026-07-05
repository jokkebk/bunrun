<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { LogLine } from "../types";
  import { renderAnsi } from "../ansi";

  let {
    lines,
    idle = false,
  }: {
    lines: LogLine[];
    idle?: boolean;
  } = $props();

  const LINE_HEIGHT = 18;
  const OVERSCAN = 8;

  let el = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportH = $state(400);
  let autoScroll = $state(true);

  let ro: ResizeObserver | null = null;

  onMount(() => {
    if (!el) return;
    ro = new ResizeObserver(() => {
      if (!el) return;
      viewportH = el.clientHeight;
    });
    ro.observe(el);
    viewportH = el.clientHeight;
  });
  onDestroy(() => ro?.disconnect());

  function onScroll() {
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    autoScroll = atBottom;
    scrollTop = el.scrollTop;
  }

  // autoscroll when new lines arrive
  $effect(() => {
    const _ = lines.length;
    if (autoScroll && el) {
      queueMicrotask(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  });

  let totalH = $derived(lines.length * LINE_HEIGHT);
  let startIdx = $derived(Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN));
  let endIdx = $derived(
    Math.min(lines.length, Math.ceil((scrollTop + viewportH) / LINE_HEIGHT) + OVERSCAN),
  );
  let visibleLines = $derived(lines.slice(startIdx, endIdx));
  let offsetY = $derived(startIdx * LINE_HEIGHT);

  function colorFor(line: LogLine): string {
    if (line.stream === "stderr") return "row-stderr";
    return "";
  }
</script>

<div
  class="vlog"
  bind:this={el}
  onscroll={onScroll}
>
  <div class="vtrack" style={`height:${totalH}px`}>
    <div class="vcontent" style={`transform:translateY(${offsetY}px)`}>
      {#each visibleLines as line, i (startIdx + i)}
        <div class="vline {colorFor(line)}" style={`height:${LINE_HEIGHT}px`}>
          <span class="vline-html"><!-- eslint-disable-next-line -->{@html renderAnsi(line.line)}</span>
        </div>
      {/each}
    </div>
  </div>
</div>