import React, { useEffect, useLayoutEffect, useRef } from "react";
import logoImg from "../assets/logo.png";
import { useI18n } from "../i18n/I18nContext";
import { GameMode, TabId, WatcherStatus } from "../types/api";

interface SidebarProps {
  mode: GameMode;
  onModeChange: (m: GameMode) => void;
  onLangChange: (l: "ru" | "en") => void;
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  watcher?: WatcherStatus;
  themeBase: string;
  themeAccent: string;
  syncing: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenTheme: () => void;
  onOpenConsole: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mode,
  onModeChange,
  onLangChange,
  activeTab,
  onTabChange,
  watcher,
  themeBase,
  themeAccent,
  syncing,
  collapsed,
  onToggleCollapse,
  onSync,
  onOpenSettings,
  onOpenTheme,
  onOpenConsole,
}) => {
  const { lang, t } = useI18n();
  const modeSwitchRef = useRef<HTMLDivElement | null>(null);
  const modeIndRef = useRef<HTMLSpanElement | null>(null);
  const navTabsRef = useRef<HTMLElement | null>(null);
  const navIndRef = useRef<HTMLSpanElement | null>(null);

  const updateIndicators = () => {
    const ms = modeSwitchRef.current;
    const mi = modeIndRef.current;
    if (ms && mi) {
      const btn = ms.querySelector<HTMLElement>(".mode-btn.active");
      if (btn) {
        mi.style.width = `${btn.offsetWidth}px`;
        mi.style.height = `${btn.offsetHeight}px`;
        mi.style.transform = `translate(${btn.offsetLeft - 3}px, ${btn.offsetTop - 3}px)`;
        mi.style.opacity = "1";
      }
    }
    const nt = navTabsRef.current;
    const ni = navIndRef.current;
    if (nt && ni) {
      const btn = nt.querySelector<HTMLElement>(".tab-btn.active");
      if (btn) {
        ni.style.width = "100%";
        ni.style.height = `${btn.offsetHeight}px`;
        ni.style.transform = `translateY(${btn.offsetTop}px)`;
        ni.style.opacity = "1";
      }
    }
  };

  useLayoutEffect(() => {
    updateIndicators();
  }, [mode, activeTab, lang, collapsed]);

  useEffect(() => {
    window.addEventListener("resize", updateIndicators);
    return () => window.removeEventListener("resize", updateIndicators);
  }, []);

  const watcherOn = Boolean(watcher?.watchLogs && watcher?.logsDir);
  const watcherModeLbl = watcher?.activeMode === "pve" ? "PvE" : "PvP";

  return (
    <aside className="app-sidebar">
      <div className="sidebar-head">
        <div className="brand-row">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <img className="brand-mark-img" src={logoImg} alt="EFT" />
            </div>
            <div className="brand-copy">
              <div className="brand-title">Eftis</div>
              <div className="brand-sub">{t("brand_sub")}</div>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title={collapsed ? (lang === "en" ? "Expand sidebar" : "Развернуть меню") : (lang === "en" ? "Collapse sidebar" : "Свернуть меню")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
            </svg>
          </button>
        </div>

        <div className="sidebar-switches">
          <div className="mode-switch has-indicator" id="modeSwitch" ref={modeSwitchRef} title={t("mode_switch_title")}>
            <span className="mode-indicator" id="modeIndicator" ref={modeIndRef} aria-hidden="true" />
            <button
              type="button"
              className={`mode-btn${mode === "regular" ? " active" : ""}`}
              data-mode="regular"
              onClick={() => onModeChange("regular")}
            >
              PvP
            </button>
            <button
              type="button"
              className={`mode-btn${mode === "pve" ? " active" : ""}`}
              data-mode="pve"
              onClick={() => onModeChange("pve")}
            >
              PvE
            </button>
          </div>

          <div className="lang-switch" id="langSwitch" title={t("lang_switch_title")}>
            <button
              type="button"
              className={`mode-btn${lang === "ru" ? " active" : ""}`}
              data-lang="ru"
              onClick={() => onLangChange("ru")}
            >
              RU
            </button>
            <button
              type="button"
              className={`mode-btn${lang === "en" ? " active" : ""}`}
              data-lang="en"
              onClick={() => onLangChange("en")}
            >
              EN
            </button>
          </div>
        </div>
      </div>

      <nav className="nav-tabs has-indicator" id="navTabs" ref={navTabsRef} aria-label={t("nav_aria")}>
        <span className="tab-indicator" id="navTabIndicator" ref={navIndRef} aria-hidden="true" />
        <button
          type="button"
          className={`tab-btn${activeTab === "quests" ? " active" : ""}`}
          data-tab="quests"
          title={t("nav_quests")}
          onClick={() => onTabChange("quests")}
        >
          <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <span>{t("nav_quests")}</span>
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "quest-tree" ? " active" : ""}`}
          data-tab="quest-tree"
          title={t("nav_quest_tree")}
          onClick={() => onTabChange("quest-tree")}
        >
          <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/></svg>
          <span>{t("nav_quest_tree")}</span>
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "maps" ? " active" : ""}`}
          data-tab="maps"
          title={t("nav_maps")}
          onClick={() => onTabChange("maps")}
        >
          <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
          <span>{t("nav_maps")}</span>
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "cultist" ? " active" : ""}`}
          data-tab="cultist"
          title={t("nav_cultist")}
          onClick={() => onTabChange("cultist")}
        >
          <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="12 5 18 17 6 17"/></svg>
          <span>{t("nav_cultist")}</span>
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "items" ? " active" : ""}`}
          data-tab="items"
          title={t("nav_items")}
          onClick={() => onTabChange("items")}
        >
          <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span>{t("nav_items")}</span>
        </button>
      </nav>

      <div className="sidebar-foot">
        <div className={`watcher-pill${watcherOn ? " ok" : ""}`} id="watcherPill" title={t("watcher_title")}>
          <span className="pill-dot" />
          <span id="watcherText">
            {watcher ? (watcherOn ? t("watcher_active", { mode: watcherModeLbl }) : t("watcher_off")) : t("watcher_checking")}
          </span>
        </div>

        <button type="button" className="theme-trigger-btn" id="btnThemeModal" title={t("theme_trigger_title")} onClick={onOpenTheme}>
          <span className="theme-pair-dots" aria-hidden="true">
            <span className="dot-base" id="dotThemeBase" style={{ background: themeBase }} />
            <span className="dot-accent" id="dotThemeAccent" style={{ background: themeAccent }} />
          </span>
          <span className="theme-trigger-label">{t("theme_trigger")}</span>
          <span className="theme-trigger-hex num" id="themeTriggerHex">{themeAccent}</span>
        </button>

        <div className="sidebar-foot-actions">
          <button type="button" className="btn btn-ghost full-btn" id="btnSync" disabled={syncing} title={t("btn_sync_title")} onClick={onSync}>
            <svg className="foot-btn-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            <span>{syncing ? t("btn_sync_busy") : t("btn_sync")}</span>
          </button>
          <button type="button" className="btn btn-ghost full-btn" id="btnSettings" title={t("btn_settings_title")} onClick={onOpenSettings}>
            <svg className="foot-btn-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>{t("btn_settings")}</span>
          </button>
        </div>
        <button type="button" className="btn btn-ghost full-btn sidebar-console-btn" style={{ marginTop: 4, fontSize: 11, opacity: 0.78 }} onClick={onOpenConsole}>
          Debug Console (F12)
        </button>
      </div>
    </aside>
  );
};
