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

export type VaultEntry = {
  id: string;
  label: string;
  value: string;
  owner: string | null;
  provider: string | null;
  defaultVarName: string | null;
};

export type VaultInput = Omit<VaultEntry, "id">;

export type EnvLine =
  | { kind: "blank"; raw: string }
  | { kind: "doc-comment"; raw: string }
  | { kind: "other"; raw: string }
  | {
      kind: "kv";
      key: string;
      value: string;
      rawValue: string | null;
      disabled: boolean;
      exportPrefix: boolean;
      inlineComment: string | null;
      prefix: string;
    };

export type EnvResponse = {
  lines: EnvLine[];
  vault: VaultEntry[];
};
