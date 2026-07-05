import { writable, type Writable } from "svelte/store";
import type { LogLine } from "./types";

const MAX = 5000;

export const logs: Map<string, LogLine[]> = new Map();
export const logTick: Writable<number> = writable(0);
const logSubs = new Map<string, ((lines: LogLine[]) => void)[]>([]);

export function appendLog(key: string, line: LogLine): void {
  let arr = logs.get(key);
  if (!arr) {
    arr = [];
    logs.set(key, arr);
  }
  arr.push(line);
  if (arr.length > MAX) {
    arr = arr.slice(-MAX);
    logs.set(key, arr);
  }
  const subs = logSubs.get(key);
  if (subs) for (const cb of subs) cb(arr);
  logTick.update((n) => n + 1);
}

export function setLogBuffer(key: string, lines: LogLine[]): void {
  logs.set(key, lines.slice());
  logTick.update((n) => n + 1);
  const subs = logSubs.get(key);
  if (subs) for (const cb of subs) cb(logs.get(key) ?? []);
}

export function subscribeLogs(
  key: string,
  cb: (lines: LogLine[]) => void,
): () => void {
  logSubs.set(key, [...(logSubs.get(key) ?? []), cb]);
  cb(logs.get(key) ?? []);
  return () => {
    const subs = (logSubs.get(key) ?? []).filter((c) => c !== cb);
    logSubs.set(key, subs);
  };
}
