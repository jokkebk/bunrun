import { spawn } from "node:child_process";
import type { ProcessConfig } from "./config.js";

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

const VITE_PORT =
  /(?:Local:|ready in|Network:).*?(?:https?:\/\/)?localhost:(\d+)/i;
const NEXT_PORT =
  /(?:started server|ready).*?(?:https?:\/\/)?(localhost|0\.0\.0\.0|\[::\]):(\d+)/i;
const GENERIC =
  /(?:https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/i;
const VITE_URL = /https?:\/\/(localhost|[\d.]+|\[[a-f0-9:]+\]):(\d+)/i;

export function scrapeUrl(config: ProcessConfig, text: string): string | null {
  const declared = config.url?.trim();
  if (declared) return declared;
  text = stripAnsi(text);
  const pattern = config.urlPattern ? new RegExp(config.urlPattern, "i") : null;
  let port: number | null = null;
  if (pattern) {
    const m = text.match(pattern);
    if (m) {
      const p = m[2] ?? m[1];
      if (p) {
        const n = Number(p);
        if (!Number.isNaN(n)) port = n;
      }
    }
  } else {
    let m = text.match(VITE_PORT);
    if (m) port = Number(m[1]);
    if (!port) {
      m = text.match(NEXT_PORT);
      if (m) port = Number(m[2]);
    }
    if (!port) {
      m = text.match(GENERIC);
      if (m) port = Number(m[2]);
    }
  }
  let url: string | null = null;
  if (port) url = `http://localhost:${port}`;
  else if (declared) url = declared;
  return url;
}

export function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cp = spawn("open", [url], { detached: true, stdio: "ignore" });
    cp.on("error", reject);
    cp.on("spawn", () => resolve());
    cp.unref();
  });
}
