import React, { useState } from "react";
import { useI18n } from "../i18n/I18nContext";

interface MapsTabProps {
  active: boolean;
}

export const MapsTab: React.FC<MapsTabProps> = ({ active }) => {
  const { lang, t } = useI18n();
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => {
    try {
      return localStorage.getItem("eft_map_filters_collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleFilters = () => {
    setFiltersCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("eft_map_filters_collapsed", next ? "1" : "0");
      } catch {
        // Ignore
      }
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
      return next;
    });
  };

  const toggleLabel = filtersCollapsed
    ? (lang === "en" ? "Filters" : "Фильтры")
    : (lang === "en" ? "Hide" : "Скрыть");

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-maps">
      <div className={`maps-layout${filtersCollapsed ? " filters-collapsed" : ""}`}>
        <aside className="map-sidebar">
          <div className="field">
            <label htmlFor="mapSelect">{t("map_location")}</label>
            <select id="mapSelect" className="select full" />
          </div>

          <div className="subtabs">
            <button type="button" className="subtab-btn active" data-maptab="layers">{t("map_tab_layers")}</button>
            <button type="button" className="subtab-btn" data-maptab="tasks">
              <span>{t("map_tab_tasks")}</span>{" "}
              <span id="mapTasksTabBadge" className="badge amber" style={{ fontSize: 10, padding: "0 5px", marginLeft: 4, display: "none" }}>
                0
              </span>
            </button>
          </div>

          <div id="mapSideLayers" className="stack-col map-side-panel" data-open="true" style={{ gap: 14 }}>
            <div className="field">
              <label>{t("map_markers")}</label>
              <div className="check-list">
                <label className="check-item"><input type="checkbox" id="layerExtractsPmc" defaultChecked /> <span className="pin-dot-legend pmc" aria-hidden="true" /> <span>{t("map_layer_pmc")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerExtractsScav" defaultChecked /> <span className="pin-dot-legend scav" aria-hidden="true" /> <span>{t("map_layer_scav")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerBosses" defaultChecked /> <span className="pin-dot-legend boss" aria-hidden="true" /> <span>{t("map_layer_bosses")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerLocks" defaultChecked /> <span>{t("map_layer_locks")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerQuests" defaultChecked /> <span>{t("map_layer_quests")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerCompletedQuests" /> <span>{t("map_layer_completed")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerAllQuests" /> <span>{t("map_layer_future")}</span></label>
                <label className="check-item"><input type="checkbox" id="layerPin" defaultChecked /> <span>{t("map_layer_pin")}</span></label>
              </div>
            </div>

            <div className="field" id="mapFloorsWrap" style={{ display: "none" }}>
              <label>{t("map_floors_label")}</label>
              <div id="mapFloors" className="floor-chips" />
            </div>

            <div className="field">
              <label>{t("map_bosses_label")}</label>
              <div id="mapBossList" className="mini-list" />
            </div>
          </div>

          <div id="mapSideTasks" className="stack-col map-side-panel" data-open="false" style={{ gap: 8 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <input type="search" id="mapTaskSearch" className="input full" placeholder={t("map_task_search_ph")} autoComplete="off" />
            </div>

            <div id="mapTaskStatusTabs" className="status-filter-row">
              <button type="button" className="btn btn-ghost active map-status-tab" data-status="active">{t("map_st_active")} (<span id="countStActive">0</span>)</button>
              <button type="button" className="btn btn-ghost map-status-tab" data-status="completed">{t("map_st_completed")} (<span id="countStCompleted">0</span>)</button>
              <button type="button" className="btn btn-ghost map-status-tab" data-status="locked">{t("map_st_locked")} (<span id="countStLocked">0</span>)</button>
              <button type="button" className="btn btn-ghost map-status-tab" data-status="all">{t("map_st_all")} (<span id="countStAll">0</span>)</button>
            </div>

            <div id="mapTaskToolbar" className="map-task-toolbar">
              <span id="mapTaskCount" className="muted num">0</span>
              <div className="toolbar">
                <button type="button" className="btn btn-ghost" id="btnSelectAllTasks" style={{ padding: "2px 6px", fontSize: 11 }}>{t("map_show_all")}</button>
                <button type="button" className="btn btn-ghost" id="btnResetTaskFilter" style={{ padding: "2px 6px", fontSize: 11, display: "none", color: "var(--accent)" }}>{t("map_reset_filter")}</button>
              </div>
            </div>

            <div id="mapActiveTasksList" className="mini-list map-tasks-scroll" />
          </div>
        </aside>

        <div className="map-stage-wrap">
          <div className="map-stage-bar">
            <div className="map-stage-title-row">
              <h2 id="mapTitle">{t("map_title_default")}</h2>
              <span id="mapRaidFilterBadge" className="badge amber" style={{ display: "none", cursor: "pointer", fontSize: 11 }} title={t("map_raid_badge_title")} />
              <span className="muted" id="mapMeta">{t("map_meta_hint")}</span>
            </div>
            <div className="toolbar">
              <button type="button" className="btn btn-ghost" id="btnMapZoomIn">+</button>
              <button type="button" className="btn btn-ghost" id="btnMapZoomOut">−</button>
              <button type="button" className="btn btn-secondary" id="btnMapReset">{t("map_btn_reset")}</button>
            </div>
          </div>
          <div className="map-viewport" id="mapViewport">
            <button
              type="button"
              className="btn btn-secondary map-viewport-filters-btn"
              onClick={toggleFilters}
              title={filtersCollapsed ? (lang === "en" ? "Show map filters" : "Развернуть фильтры карты") : (lang === "en" ? "Hide map filters" : "Скрыть фильтры карты")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {filtersCollapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
              </svg>
              <span>{toggleLabel}</span>
            </button>
            <div className="map-canvas" id="mapCanvas">
              <div id="mapSvgHost" />
              <div id="mapPinsHost" />
            </div>
            <div id="mapTooltip" className="map-tooltip" data-open="false" aria-hidden="true" />
            <div id="mapPinPopover" className="map-popover" data-open="false" aria-hidden="true" role="dialog" aria-label={t("map_popover_aria")} />
          </div>
        </div>
      </div>
    </section>
  );
};
