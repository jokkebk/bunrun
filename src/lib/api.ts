export async function call<T = unknown>(
  action: "start" | "stop" | "restart" | "startAll",
  projectId: string,
  procName?: string,
): Promise<T> {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, projectId, procName }),
  });
  return (await res.json()) as T;
}

export async function saveProjects(projects: any[]): Promise<void> {
  await fetch("/api/projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projects),
  });
}

export async function fetchLogs(
  projectId: string,
  procName: string,
): Promise<any[]> {
  const res = await fetch(
    `/api/logs/${encodeURIComponent(projectId)}/${encodeURIComponent(procName)}`,
  );
  return await res.json();
}
