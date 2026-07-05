import type { FullState, LogLine } from "./types";

type StateListener = (s: FullState, prev: FullState | null) => void;
type LogListener = (key: string, line: LogLine) => void;

const stateListeners = new Set<StateListener>();
const logListeners = new Set<LogListener>();

let _state: FullState | null = null;
let _es: EventSource | null = null;
let _reconnectTimer: number | null = null;

export function getState(): FullState | null {
  return _state;
}

export function connect(): void {
  if (_es) return;
  _es = new EventSource("/events");
  let opened = false;
  _es.onopen = () => {
    if (opened) console.log("[sse] reconnected");
    opened = true;
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
  };
  _es.addEventListener("state", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data);
      const next = payload.data as FullState;
      const prev = _state;
      _state = next;
      for (const l of stateListeners) l(next, prev);
    } catch (err) {
      console.error("state parse", err);
    }
  });
  _es.addEventListener("log", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data);
      const { key, line } = payload.data;
      for (const l of logListeners) l(key, line as LogLine);
    } catch (err) {
      console.error("log parse", err);
    }
  });
  _es.onerror = () => {
    if (_reconnectTimer) return;
    _es?.close();
    _es = null;
    _reconnectTimer = window.setTimeout(() => {
      _reconnectTimer = null;
      connect();
    }, 1500);
  };
}

export function onState(listener: StateListener): () => void {
  stateListeners.add(listener);
  if (_state) listener(_state, _state);
  return () => stateListeners.delete(listener);
}

export function onLog(listener: LogListener): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}
