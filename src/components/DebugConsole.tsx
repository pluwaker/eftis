import React, { useEffect, useRef, useState } from "react";
import { clearDebugLogs, DebugLogEntry, subscribeDebugLogs } from "../utils/debugLog";

interface DebugConsoleProps {
  open: boolean;
  onClose: () => void;
}

export const DebugConsole: React.FC<DebugConsoleProps> = ({ open, onClose }) => {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "error" | "backend" | "api">("all");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeDebugLogs(setLogs), []);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, logs.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = logs.filter((x) => {
    if (filter === "error") return x.level === "error" || x.level === "warn";
    if (filter === "backend") return x.level === "backend";
    if (filter === "api") return x.level === "api";
    return true;
  });

  const copyAll = () => {
    const text = filtered.map((x) => `[${x.ts}] [${x.level.toUpperCase()}] [${x.source}] ${x.message}`).join("\n");
    void navigator.clipboard?.writeText(text);
  };

  const levelColor: Record<string, string> = {
    error: "#ef4444",
    warn: "#f59e0b",
    api: "#38bdf8",
    backend: "#a855f7",
    info: "#94a3b8",
  };

  return (
    <div
      className="modal-backdrop"
      data-open="true"
      id="debugConsoleModal"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal panel-dialog"
        style={{ width: "min(920px, calc(100vw - 32px))", height: "min(640px, calc(100vh - 48px))", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Debug Console (F12)</h3>
            <p className="muted" style={{ fontSize: 12 }}>Backend (Python), HTTP API &amp; Frontend JS logs</p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              className="select"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              style={{ fontSize: 12, padding: "4px 8px" }}
            >
              <option value="all">All ({logs.length})</option>
              <option value="error">Errors / Warn ({logs.filter((l) => l.level === "error" || l.level === "warn").length})</option>
              <option value="backend">Backend ({logs.filter((l) => l.level === "backend").length})</option>
              <option value="api">API ({logs.filter((l) => l.level === "api").length})</option>
            </select>
            <button type="button" className="btn btn-secondary" onClick={copyAll}>Copy</button>
            <button type="button" className="btn btn-ghost" onClick={clearDebugLogs}>Clear</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "10px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.5,
            background: "var(--bg-inset)",
            borderTop: "1px solid var(--border)",
          }}
        >
          {filtered.length ? (
            filtered.map((entry) => (
              <div key={entry.id} style={{ display: "flex", gap: 8, padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", wordBreak: "break-word" }}>
                <span style={{ color: "var(--text-subtle)", flexShrink: 0 }}>{entry.ts}</span>
                <span style={{ color: levelColor[entry.level] || "#94a3b8", fontWeight: 600, minWidth: 56, flexShrink: 0 }}>
                  {entry.level.toUpperCase()}
                </span>
                <span style={{ color: "var(--accent)", flexShrink: 0 }}>[{entry.source}]</span>
                <span style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{entry.message}</span>
              </div>
            ))
          ) : (
            <div className="muted">No logs yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};
