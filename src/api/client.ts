import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { pushDebugLog } from "../utils/debugLog";

let cachedBase = "";
let resolvingPromise: Promise<string> | null = null;

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function initApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (resolvingPromise) return resolvingPromise;

  resolvingPromise = (async () => {
    if (isTauriEnv()) {
      try {
        const port = await invoke<number>("get_backend_port");
        if (port && port > 0) {
          cachedBase = `http://127.0.0.1:${port}`;
          pushDebugLog("info", "api", `Tauri backend port resolved: ${cachedBase}`);
          return cachedBase;
        }
        pushDebugLog("warn", "api", `get_backend_port returned ${port}, using fallback`);
      } catch (err) {
        pushDebugLog("error", "api", `get_backend_port failed: ${String(err)}`);
      }
    }
    const envBase = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE;
    cachedBase = envBase || "http://127.0.0.1:8749";
    pushDebugLog("info", "api", `API base fallback: ${cachedBase}`);
    return cachedBase;
  })();

  return resolvingPromise;
}

export function getApiBaseSync(): string {
  return cachedBase || "http://127.0.0.1:8749";
}

export function mediaProxyUrl(rawUrl: string): string {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  if (s.startsWith("https://minio.tarkov.help/") || s.startsWith("https://assets.tarkov.dev/")) {
    return `${getApiBaseSync()}/api/media-proxy?url=${encodeURIComponent(s)}`;
  }
  return s;
}

export async function apiFetch<T = unknown>(
  url: string,
  lang: string,
  opts: RequestInit = {},
): Promise<T> {
  const base = await initApiBase();
  let targetUrl = url;
  if (targetUrl.startsWith("/api/") && !/[?&]lang=/.test(targetUrl)) {
    const sep = targetUrl.includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}lang=${encodeURIComponent(lang)}`;
  }
  const fullUrl = targetUrl.startsWith("http") ? targetUrl : `${base}${targetUrl}`;
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> | undefined) };
  if (opts.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const method = (opts.method || "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      ...opts,
      headers,
    });
  } catch (err) {
    pushDebugLog("error", "api", `${method} ${targetUrl} -> ${(err as Error)?.message || String(err)}`);
    throw err;
  }
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && (data.error as string)) || `HTTP ${res.status}`;
    pushDebugLog("error", "api", `${method} ${targetUrl} -> ${res.status}: ${msg}`);
    throw new Error(msg);
  }
  pushDebugLog("api", "api", `${method} ${targetUrl} -> ${res.status}`);
  return data as T;
}

export async function pickFolderDialog(title: string): Promise<string | null> {
  if (!isTauriEnv()) return null;
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}
