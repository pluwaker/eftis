export type LogLevel = "info" | "warn" | "error" | "api" | "backend";

export interface DebugLogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
}

type Listener = (entries: DebugLogEntry[]) => void;

const MAX_LOGS = 400;
let seq = 1;
let entries: DebugLogEntry[] = [];
const listeners = new Set<Listener>();
let installed = false;

function nowTime(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function notify(): void {
  const snap = [...entries];
  listeners.forEach((fn) => fn(snap));
}

export function pushDebugLog(level: LogLevel, source: string, message: string): void {
  entries.push({
    id: seq++,
    ts: nowTime(),
    level,
    source,
    message: String(message || ""),
  });
  if (entries.length > MAX_LOGS) {
    entries = entries.slice(entries.length - MAX_LOGS);
  }
  notify();
}

export function clearDebugLogs(): void {
  entries = [];
  notify();
}

export function getDebugLogs(): DebugLogEntry[] {
  return [...entries];
}

export function subscribeDebugLogs(fn: Listener): () => void {
  listeners.add(fn);
  fn([...entries]);
  return () => {
    listeners.delete(fn);
  };
}

export function installGlobalErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    origError(...args);
    pushDebugLog("error", "console", args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(" "));
  };

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    pushDebugLog("warn", "console", args.map((a) => String(a)).join(" "));
  };

  window.addEventListener("error", (ev) => {
    const loc = ev.filename ? ` (${ev.filename}:${ev.lineno}:${ev.colno})` : "";
    pushDebugLog("error", "window", `${ev.message}${loc}`);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.stack || ev.reason.message : String(ev.reason);
    pushDebugLog("error", "promise", reason);
  });
}
