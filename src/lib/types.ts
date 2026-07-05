export type ProcessConfig = {
  name: string;
  command: string;
  cwd: string | null;
  port: number | null;
  url: string | null;
  urlPattern: string | null;
  openOnStart: boolean;
};

export type ProjectUi = { pinned: boolean; logEnabled: boolean };

export type ProjectConfig = {
  id: string;
  name: string;
  path: string;
  category: string | null;
  favicon: string | null;
  envFile: string | null;
  processes: ProcessConfig[];
  ui: ProjectUi;
};

export type ProcessStatus = "stopped" | "running" | "stopping" | "crashed";

export type ProcessState = {
  key: string;
  projectId: string;
  procName: string;
  status: ProcessStatus;
  pid: number | null;
  pgid: number | null;
  exitCode: number | null;
  url: string | null;
  opened: boolean;
  config: ProcessConfig;
};

export type FullState = {
  projects: ProjectConfig[];
  processes: ProcessState[];
};

export type LogLine = {
  ts: number;
  stream: "stdout" | "stderr";
  line: string;
  url?: string;
};
