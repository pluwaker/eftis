import React, { useState } from "react";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n/I18nContext";
import { GameMode } from "../types/api";
import { fmtNum, fmtRub } from "../utils/format";

export interface QuestsPayload {
  counts: { completed: number; total: number; active: number; available: number; failed?: number; locked: number };
  kappa: { done: number; total: number };
  velocity: { date: string; completed: number }[];
  neededFir: { name: string; count: number; tasks: string[] }[];
  neededKeys: { name: string; price?: number; tasks: string[] }[];
  history: { task_name: string; event_type: string; occurred_at: string; source: string; xp?: number }[];
  tasks: {
    id: string;
    name: string;
    traderName: string;
    mapName: string;
    minPlayerLevel: number;
    experience: number;
    kappaRequired: boolean;
    lightkeeperRequired: boolean;
    status: string;
    objectives?: { description?: string; foundInRaid?: boolean }[];
    neededKeys?: { name: string; shortName?: string }[];
  }[];
}

interface QuestsTabProps {
  active: boolean;
  mode: GameMode;
  data: QuestsPayload | null;
  loading: boolean;
  onOpenGuide: (taskId: string) => void;
  onStatusChanged: () => Promise<void>;
  onModeSwitchFromImport: (nextMode: GameMode) => Promise<void>;
  onToast: (msg: string) => void;
}

export const QuestsTab: React.FC<QuestsTabProps> = ({
  active,
  mode,
  data,
  loading,
  onOpenGuide,
  onStatusChanged,
  onModeSwitchFromImport,
  onToast,
}) => {
  const { lang, t } = useI18n();
  const [needTab, setNeedTab] = useState<"fir" | "keys" | "history">("fir");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("playable");
  const [importing, setImporting] = useState(false);

  const c = data?.counts || { completed: 0, total: 0, active: 0, available: 0, locked: 0 };
  const totalXp = (data?.history || [])
    .filter((h) => h.event_type === "completed")
    .reduce((s, h) => s + (h.xp || 0), 0);
  const donePct = Math.round((c.completed / Math.max(1, c.total)) * 100);
  const kappaPct = Math.round(((data?.kappa?.done || 0) / Math.max(1, data?.kappa?.total || 1)) * 100);

  const q = search.trim().toLowerCase();
  const allFiltered = (data?.tasks || []).filter((task) => {
    if (filter === "playable" && task.status !== "active" && task.status !== "available") return false;
    else if (filter === "active" && task.status !== "active") return false;
    else if (filter === "available" && task.status !== "available") return false;
    else if (filter === "completed" && task.status !== "completed") return false;
    else if (filter === "kappa" && !task.kappaRequired) return false;
    else if (filter === "lightkeeper" && !task.lightkeeperRequired) return false;

    if (q) {
      const hay = `${task.name} ${task.traderName} ${task.mapName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const filtered = allFiltered.slice(0, 200);

  const handleStatusChange = async (taskId: string, status: string) => {
    try {
      await apiFetch("/api/quests/status", lang, {
        method: "POST",
        body: JSON.stringify({ mode, taskId, status }),
      });
      onToast(t("toast_status_updated"));
      await onStatusChanged();
    } catch (err) {
      onToast((lang === "en" ? "Error: " : "Ошибка: ") + (err as Error).message);
    }
  };

  const handleImportLogs = async () => {
    setImporting(true);
    try {
      const res = await apiFetch<{
        ok?: boolean;
        error?: string;
        foldersScanned?: number;
        importedEvents?: number;
        savedCounts?: Record<string, number>;
        activeMode?: GameMode;
      }>("/api/quests/import-logs", lang, { method: "POST", body: "{}" });
      if (!res.ok) {
        onToast(res.error || (lang === "en" ? "Logs not found" : "Логи не найдены"));
      } else {
        const sc = res.savedCounts || {};
        onToast(
          lang === "en"
            ? `Folders: ${res.foldersScanned}, new events: ${res.importedEvents} (PvE: ${sc.pve || 0}, PvP: ${sc.regular || 0})`
            : `Папок: ${res.foldersScanned}, новых событий: ${res.importedEvents} (всего в базе PvE: ${sc.pve || 0}, PvP: ${sc.regular || 0})`,
        );
        if (
          res.activeMode &&
          res.activeMode !== mode &&
          (sc[res.activeMode] || 0) > 0 &&
          (sc[mode] || 0) === 0
        ) {
          await onModeSwitchFromImport(res.activeMode);
        }
      }
      await onStatusChanged();
    } catch (err) {
      onToast((lang === "en" ? "Import error: " : "Ошибка импорта: ") + (err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const velocity = data?.velocity || [];
  const maxVel = Math.max(1, ...velocity.map((v) => v.completed));

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-quests">
      <header className="view-header">
        <div className="view-header-title">
          <h1>{t("quests_title")}</h1>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary" disabled={importing} onClick={handleImportLogs}>
            {importing ? t("btn_import_busy") : t("btn_import_logs")}
          </button>
        </div>
      </header>

      <div className="telemetry-strip" id="questKpis">
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("kpi_done")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value">{c.completed} / {c.total}</div>
            <div className="telemetry-delta">{donePct}%</div>
          </div>
          <div className="telemetry-bar"><div className="telemetry-bar-fill green" style={{ width: `${donePct}%` }} /></div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("kpi_active")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value">{c.active}</div>
            <div className="telemetry-delta">{t("kpi_active_sub")}</div>
          </div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("kpi_available")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value">{c.available}</div>
            <div className="telemetry-delta">{t("kpi_available_sub")}</div>
          </div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("kpi_kappa")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value accent">{data?.kappa?.done || 0} / {data?.kappa?.total || 0}</div>
            <div className="telemetry-delta">{kappaPct}%</div>
          </div>
          <div className="telemetry-bar"><div className="telemetry-bar-fill accent" style={{ width: `${kappaPct}%` }} /></div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("kpi_xp")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value">{fmtNum(totalXp, lang)}</div>
          </div>
        </div>
      </div>

      <div className="brief-band">
        <section className="brief-pane">
          <div className="pane-head">
            <h2>{t("quests_velocity")}</h2>
          </div>
          <div id="questVelocityChart" className="chart-box">
            {!velocity.length ? (
              <div className="muted" style={{ fontSize: 12 }}>{t("quests_velocity_empty")}</div>
            ) : (
              <svg viewBox="0 0 560 112" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
                {velocity.map((v, i) => {
                  const slotW = (560 - 36) / velocity.length;
                  const bw = Math.max(8, Math.min(28, slotW * 0.62));
                  const x = 18 + i * slotW + (slotW - bw) / 2;
                  const bh = Math.max(3, Math.round((v.completed / maxVel) * 72));
                  const y = 112 - 22 - bh;
                  return (
                    <g key={v.date}>
                      <rect x={x} y={y} width={bw} height={bh} rx={2} fill="var(--accent)" opacity={0.85}>
                        <title>{`${v.date}: ${v.completed}`}</title>
                      </rect>
                      {(velocity.length <= 14 || i % Math.ceil(velocity.length / 10) === 0) && (
                        <text x={x + bw / 2} y={104} textAnchor="middle" fill="var(--text-subtle)" fontSize="9" fontFamily="var(--font-mono)">
                          {v.date.slice(5)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </section>

        <section className="brief-pane">
          <div className="pane-head">
            <h2>{t("quests_needs")}</h2>
            <div className="subtabs compact">
              <button type="button" className={`subtab-btn${needTab === "fir" ? " active" : ""}`} onClick={() => setNeedTab("fir")}>
                {t("need_fir")}
              </button>
              <button type="button" className={`subtab-btn${needTab === "keys" ? " active" : ""}`} onClick={() => setNeedTab("keys")}>
                {t("need_keys")}
              </button>
              <button type="button" className={`subtab-btn${needTab === "history" ? " active" : ""}`} onClick={() => setNeedTab("history")}>
                {t("need_history")}
              </button>
            </div>
          </div>
          <div id="questNeedsBody" className="scroll-box">
            {needTab === "fir" &&
              ((data?.neededFir || []).length ? (
                (data?.neededFir || []).map((it, idx) => (
                  <div key={idx} className="list-row">
                    <div>
                      <b>{it.name}</b>
                      <div className="muted">{(it.tasks || []).slice(0, 2).join(", ")}</div>
                    </div>
                    <span className="badge amber num">×{it.count} FIR</span>
                  </div>
                ))
              ) : (
                <div className="muted">{t("need_fir_empty")}</div>
              ))}

            {needTab === "keys" &&
              ((data?.neededKeys || []).length ? (
                (data?.neededKeys || []).map((k, idx) => (
                  <div key={idx} className="list-row">
                    <div>
                      <b>{k.name}</b>
                      <div className="muted">{(k.tasks || []).slice(0, 2).join(", ")}</div>
                    </div>
                    <span className="badge num">{fmtRub(k.price, lang)}</span>
                  </div>
                ))
              ) : (
                <div className="muted">{t("need_keys_empty")}</div>
              ))}

            {needTab === "history" &&
              ((data?.history || []).length ? (
                (data?.history || []).map((h, idx) => {
                  const labels: Record<string, [string, string]> =
                    lang === "en"
                      ? { completed: ["Completed", "green"], active: ["Started", "blue"], failed: ["Failed", "red"] }
                      : { completed: ["Завершён", "green"], active: ["Взят", "blue"], failed: ["Провален", "red"] };
                  const [lbl, cls] = labels[h.event_type] || [h.event_type, ""];
                  return (
                    <div key={idx} className="list-row">
                      <div>
                        <b>{h.task_name}</b>
                        <div className="muted">{h.occurred_at.replace("T", " ")} • {h.source}</div>
                      </div>
                      <span className={`badge ${cls}`}>{lbl}</span>
                    </div>
                  );
                })
              ) : (
                <div className="muted">{t("need_history_empty")}</div>
              ))}
          </div>
        </section>
      </div>

      <section className="ledger-section">
        <div className="ledger-toolbar">
          <div className="toolbar">
            <input
              type="search"
              className="input quest-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("quest_search_ph")}
            />
            <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="playable">{t("filter_playable")}</option>
              <option value="active">{t("filter_active")}</option>
              <option value="available">{t("filter_available")}</option>
              <option value="completed">{t("filter_completed")}</option>
              <option value="kappa">{t("filter_kappa")}</option>
              <option value="lightkeeper">{t("filter_lightkeeper")}</option>
              <option value="all">{t("filter_all")}</option>
            </select>
          </div>
          <span className="muted num" style={{ fontSize: 12 }}>
            {allFiltered.length > filtered.length
              ? t("quests_shown", { shown: filtered.length, total: allFiltered.length })
              : lang === "en"
                ? `Shown: ${filtered.length}`
                : `Показано: ${filtered.length}`}
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("th_quest")}</th>
                <th>{t("th_trader")}</th>
                <th>{t("th_map")}</th>
                <th>{t("th_lvl")}</th>
                <th>{t("th_xp")}</th>
                <th>{t("th_cond")}</th>
                <th>{t("th_status")}</th>
              </tr>
            </thead>
            <tbody id="questTableBody">
              {loading && !data ? (
                <tr><td colSpan={7} className="muted">{lang === "en" ? "Loading quests..." : "Загрузка квестов..."}</td></tr>
              ) : filtered.length ? (
                filtered.map((task) => {
                  const keysStr = (task.neededKeys || []).map((k) => k.shortName || k.name).join(", ");
                  const firCount = (task.objectives || []).filter((o) => o.foundInRaid).length;
                  const objText = (task.objectives || [])
                    .slice(0, 2)
                    .map((o) => o.description)
                    .filter(Boolean)
                    .join(" • ");

                  return (
                    <tr key={task.id}>
                      <td>
                        <div className="quest-row-title">
                          <span className="quest-row-name">{task.name}</span>
                          {task.kappaRequired && <span className="badge amber">Kappa</span>}
                          {task.lightkeeperRequired && (
                            <span className="badge blue">{lang === "en" ? "Lightkeeper" : "Смотритель"}</span>
                          )}
                          <button type="button" className="btn-guide compact" onClick={() => onOpenGuide(task.id)}>
                            <svg className="guide-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                            {t("btn_guide")}
                          </button>
                        </div>
                        {objText && <div className="quest-row-obj">{objText}</div>}
                      </td>
                      <td>{task.traderName}</td>
                      <td>{task.mapName || t("any_map")}</td>
                      <td className="num">{task.minPlayerLevel}</td>
                      <td className="num">{fmtNum(task.experience, lang)}</td>
                      <td>
                        {keysStr && <span className="badge">{keysStr}</span>}{" "}
                        {firCount > 0 && <span className="badge amber">FIR</span>}
                      </td>
                      <td>
                        <select
                          className="status-select"
                          value={task.status}
                          onChange={(e) => handleStatusChange(task.id, e.target.value)}
                        >
                          <option value="available">{t("status_available")}</option>
                          <option value="active">{t("status_active")}</option>
                          <option value="completed">{t("status_completed")}</option>
                          <option value="failed">{t("status_failed")}</option>
                          <option value="locked">{t("status_locked_long")}</option>
                        </select>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={7} className="muted">{t("quests_empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
};
