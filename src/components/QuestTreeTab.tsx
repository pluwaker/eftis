import React from "react";
import { useI18n } from "../i18n/I18nContext";

interface QuestTreeTabProps {
  active: boolean;
}

export const QuestTreeTab: React.FC<QuestTreeTabProps> = ({ active }) => {
  const { t } = useI18n();

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-quest-tree">
      <header className="view-header">
        <div className="view-header-title">
          <h1>{t("tree_title")}</h1>
        </div>
        <div className="toolbar wrap">
          <input
            id="treeSearch"
            className="input"
            type="search"
            placeholder={t("tree_search_ph")}
            style={{ minWidth: 190 }}
          />
          <select id="treeTraderFilter" className="select">
            <option value="all">{t("tree_all_traders")}</option>
          </select>
          <select id="treeImportanceFilter" className="select" defaultValue="all">
            <option value="all">{t("tree_imp_all")}</option>
            <option value="kappa">{t("tree_imp_kappa")}</option>
            <option value="lightkeeper">{t("tree_imp_lk")}</option>
            <option value="chains">{t("tree_imp_chains")}</option>
          </select>
          <select id="treeStatusFilter" className="select" defaultValue="all">
            <option value="all">{t("tree_st_all")}</option>
            <option value="incomplete">{t("tree_st_incomplete")}</option>
            <option value="playable">{t("tree_st_playable")}</option>
          </select>
          <select id="treeColorMode" className="select" defaultValue="chains" title={t("tree_color_title")}>
            <option value="chains">{t("tree_color_chains")}</option>
            <option value="traders">{t("tree_color_traders")}</option>
            <option value="status">{t("tree_color_status")}</option>
          </select>
        </div>
      </header>

      <div className="tree-controls-bar">
        <div className="toolbar wrap">
          <label className="check-item">
            <input type="checkbox" id="treeChainOnly" /> <span>{t("tree_isolate")}</span>
          </label>
          <span className="muted num" id="treeStatsLabel" />
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-ghost" id="btnTreeFocusActive" title={t("tree_focus_active_title")}>
            {t("tree_focus_active")}
          </button>
          <button type="button" className="btn" id="btnTreeZoomOut" title={t("tree_zoom_out_title")}>−</button>
          <span className="badge num" id="treeZoomLabel">100%</span>
          <button type="button" className="btn" id="btnTreeZoomIn" title={t("tree_zoom_in_title")}>+</button>
          <button type="button" className="btn" id="btnTreeFit" title={t("tree_fit_title")}>{t("tree_fit")}</button>
        </div>
      </div>

      <div className="tree-legend-bar" id="treeLegendBar" />
      <div id="treeSelectedBanner" className="inspector-box" style={{ marginBottom: 10, display: "none" }} />

      <div className="tree-viewport" id="questTreeViewport">
        <canvas className="tree-canvas" id="questTreeCanvas" aria-hidden="true" />
        <div className="tree-stage" id="questTreeStage" />
      </div>
    </section>
  );
};
