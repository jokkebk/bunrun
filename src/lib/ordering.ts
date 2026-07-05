import type { ProjectConfig, ProcessState } from "./types";

export function orderProjects(
  projects: ProjectConfig[],
  processes: ProcessState[],
): ProjectConfig[] {
  const psByProject = new Map<string, ProcessState[]>();
  for (const ps of processes) {
    const arr = psByProject.get(ps.projectId) ?? [];
    arr.push(ps);
    psByProject.set(ps.projectId, arr);
  }
  return projects.slice().sort((a, b) => {
    const aps = psByProject.get(a.id) ?? [];
    const bps = psByProject.get(b.id) ?? [];
    const aCrashed = aps.some((p) => p.status === "crashed");
    const bCrashed = bps.some((p) => p.status === "crashed");
    if (aCrashed !== bCrashed) return aCrashed ? -1 : 1;
    const aRunning = aps.some(
      (p) => p.status === "running" || p.status === "stopping",
    );
    const bRunning = bps.some(
      (p) => p.status === "running" || p.status === "stopping",
    );
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    if (!!a.ui?.pinned !== !!b.ui?.pinned) return a.ui?.pinned ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
