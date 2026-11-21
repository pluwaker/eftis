import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { apiFetch, initApiBase, isTauriEnv, mediaProxyUrl } from "./api/client";
import { AsciiShaderBg } from "./components/AsciiShaderBg";
import { BootOverlay } from "./components/BootOverlay";
import { CultistTab } from "./components/CultistTab";
import { DebugConsole } from "./components/DebugConsole";
import { ItemsTab } from "./components/ItemsTab";
import { MapsTab } from "./components/MapsTab";
import { GuideData, QuestGuideModal } from "./components/QuestGuideModal";
import { QuestsPayload, QuestsTab } from "./components/QuestsTab";
import { QuestTreeTab } from "./components/QuestTreeTab";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { ThemeModal } from "./components/ThemeModal";
import { createMapsEngine } from "./engines/mapsEngine";
import { createQuestTreeEngine } from "./engines/questTreeEngine";
import { useI18n } from "./i18n/I18nContext";
import { applyThemeToDocument, loadSavedTheme, ThemeConfig } from "./theme/theme";
import { BootstrapConfig, BootstrapResponse, GameMode, TabId, WatcherStatus } from "./types/api";
import { installGlobalErrorCapture, pushDebugLog } from "./utils/debugLog";

installGlobalErrorCapture();

declare global {
  interface Window {
    openQuestGuide?: (taskId: string, forceRefresh?: boolean) => void;
    t?: (key: string, vars?: Record<string, string | number | null | undefined> | null) => string;
  }
}

export const App: React.FC = () => {
  const { lang, setLang, t } = useI18n();
  const [mode, setMode] = useState<GameMode>("regular");
  const [activeTab, setActiveTab] = useState<TabId>("quests");
  const [dataRev, setDataRev] = useState(1);

  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [watcher, setWatcher] = useState<WatcherStatus | undefined>(undefined);
  const [questsData, setQuestsData] = useState<QuestsPayload | null>(null);
  const [questsLoading, setQuestsLoading] = useState(false);

  const [bootVisible, setBootVisible] = useState(true);
  const [bootPct, setBootPct] = useState(15);
  const [bootText, setBootText] = useState(() => t("boot_init"));

  const [syncing, setSyncing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("eft_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("eft_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // Ignore
      }
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
      return next;
    });
  };

  const [themeState, setThemeState] = useState(() => applyThemeToDocument(loadSavedTheme(), false));
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideData, setGuideData] = useState<GuideData | null>(null);
  const [guideHud, setGuideHud] = useState<string | null>(null);
  const guideSeqRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const sharedStateRef = useRef({
    mode: "regular" as GameMode,
    lang: lang as "ru" | "en",
    activeTab: "quests" as TabId,
    bootstrap: null as BootstrapResponse | null,
    quests: null as QuestsPayload | null,
    questsMode: null as GameMode | null,
    questsLang: null as string | null,
    dataRev: 1,
    isGesturing: false,
    currentMapNorm: "customs",
    currentMapData: null as any,
    mapZoom: 1,
    mapPanX: 0,
    mapPanY: 0,
    selectedTreeTaskId: null as string | null,
    focusedMapTaskId: null as string | null,
    selectedMapTaskIds: new Set<string>(),
    mapTaskSearchQuery: "",
    mapTaskStatusFilter: "active",
  });

  const renderCacheRef = useRef({
    questsSig: null as string | null,
    treeSig: null as string | null,
    mapsSig: null as string | null,
    mapsDataByKey: new Map<string, any>(),
    cultistSig: null as string | null,
    itemsSig: null as string | null,
  });

  const treeEngineRef = useRef<ReturnType<typeof createQuestTreeEngine> | null>(null);
  const mapsEngineRef = useRef<ReturnType<typeof createMapsEngine> | null>(null);

  sharedStateRef.current.mode = mode;
  sharedStateRef.current.lang = lang;
  sharedStateRef.current.activeTab = activeTab;
  sharedStateRef.current.dataRev = dataRev;

  const invalidateDataCache = useCallback((clearMaps = false) => {
    setDataRev((r) => r + 1);
    sharedStateRef.current.dataRev += 1;
    sharedStateRef.current.quests = null;
    sharedStateRef.current.questsMode = null;
    sharedStateRef.current.questsLang = null;
    renderCacheRef.current.questsSig = null;
    renderCacheRef.current.treeSig = null;
    renderCacheRef.current.mapsSig = null;
    renderCacheRef.current.cultistSig = null;
    renderCacheRef.current.itemsSig = null;
    if (clearMaps) renderCacheRef.current.mapsDataByKey.clear();
  }, []);

  const loadQuests = useCallback(
    async (targetMode: GameMode, targetLang: "ru" | "en", force = false) => {
      if (
        !force &&
        sharedStateRef.current.quests &&
        sharedStateRef.current.questsMode === targetMode &&
        sharedStateRef.current.questsLang === targetLang
      ) {
        return sharedStateRef.current.quests;
      }
      setQuestsLoading(true);
      try {
        const q = await apiFetch<QuestsPayload>(`/api/quests?mode=${targetMode}`, targetLang);
        sharedStateRef.current.quests = q;
        sharedStateRef.current.questsMode = targetMode;
        sharedStateRef.current.questsLang = targetLang;
        setQuestsData(q);
        return q;
      } finally {
        setQuestsLoading(false);
      }
    },
    [],
  );

  const guideLoadingTaskRef = useRef<string | null>(null);

  const openQuestGuide = useCallback(
    async (taskId: string, forceRefresh = false) => {
      if (!forceRefresh && guideLoadingTaskRef.current === taskId) return;
      guideLoadingTaskRef.current = taskId;
      const reqId = ++guideSeqRef.current;
      const curState = sharedStateRef.current;
      const activeTask =
        (curState.currentMapData?.activeMapTasks || []).find((x: any) => x.taskId === taskId) ||
        (curState.quests?.tasks || []).find((x) => x.id === taskId);
      const taskName = activeTask?.taskName || activeTask?.name || (curState.lang === "en" ? "Quest" : "Квест");

      setGuideHud(t("guide_hud_loading", { name: taskName }));
      try {
        const data = await apiFetch<GuideData>(
          `/api/tasks/${encodeURIComponent(taskId)}/guide?mode=${curState.mode}&lang=${curState.lang}${forceRefresh ? "&force=1" : ""}`,
          curState.lang,
        );
        if (reqId !== guideSeqRef.current) return;

        const thumbUrl = mediaProxyUrl(data.briefing?.taskImageLink || "");
        const urls = [thumbUrl, ...(data.images || []).slice(0, 10).map(mediaProxyUrl)].filter(Boolean);
        if (urls.length) {
          setGuideHud(`${data.taskName || taskName} (${urls.length})`);
          await Promise.race([
            Promise.all(
              urls.map(
                (u) =>
                  new Promise<void>((res) => {
                    const img = new Image();
                    img.onload = () => res();
                    img.onerror = () => res();
                    img.src = u;
                  }),
              ),
            ),
            new Promise<void>((res) => window.setTimeout(res, 8000)),
          ]);
        }
        if (reqId !== guideSeqRef.current) return;
        guideLoadingTaskRef.current = null;
        setGuideHud(null);
        setGuideData(data);
        setGuideOpen(true);
      } catch (err) {
        if (reqId !== guideSeqRef.current) return;
        guideLoadingTaskRef.current = null;
        setGuideHud(null);
        showToast(`${t("guide_error_prefix")}${(err as Error).message || err}`);
      }
    },
    [t, showToast],
  );

  const tRef = useRef(t);
  tRef.current = t;
  const openQuestGuideRef = useRef(openQuestGuide);
  openQuestGuideRef.current = openQuestGuide;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const invalidateDataCacheRef = useRef(invalidateDataCache);
  invalidateDataCacheRef.current = invalidateDataCache;
  const loadQuestsRef = useRef(loadQuests);
  loadQuestsRef.current = loadQuests;

  useEffect(() => {
    window.t = (k, vars) => tRef.current(k, vars);
    window.openQuestGuide = (taskId, forceRefresh) => {
      void openQuestGuideRef.current(taskId, forceRefresh);
    };
  }, []);

  const populateMapSelect = useCallback((bs: BootstrapResponse) => {
    const sel = document.getElementById("mapSelect") as HTMLSelectElement | null;
    if (!sel || !bs?.maps) return;
    const svgMaps = bs.maps.filter((m) => m.hasSvg);
    const prev = sharedStateRef.current.currentMapNorm;
    sel.innerHTML = svgMaps
      .map((m) => `<option value="${m.normalizedName}">${m.name}</option>`)
      .join("");
    if (svgMaps.some((m) => m.normalizedName === prev)) sel.value = prev;
    else if (svgMaps.length) {
      sharedStateRef.current.currentMapNorm = svgMaps[0].normalizedName;
      sel.value = svgMaps[0].normalizedName;
    }
  }, []);

  // Initialize imperative engines (QuestTree & Maps) once after mount
  useEffect(() => {
    const deps = {
      state: sharedStateRef.current,
      renderCache: renderCacheRef.current,
      api: (url: string, opts?: RequestInit) => apiFetch(url, sharedStateRef.current.lang, opts),
      t: (k: string, vars?: Record<string, unknown> | null) => tRef.current(k, vars as any),
      openQuestGuide: (id: string) => void openQuestGuideRef.current(id),
      showToast: (msg: string) => showToastRef.current(msg),
      invalidateDataCache: (clearMaps = false) => invalidateDataCacheRef.current(clearMaps),
      ensureQuestsData: (force = false) =>
        loadQuestsRef.current(sharedStateRef.current.mode, sharedStateRef.current.lang, force),
    };
    treeEngineRef.current = createQuestTreeEngine(deps);
    mapsEngineRef.current = createMapsEngine(deps);
  }, []);

  // Toggle Debug Console with F12 & stream Tauri backend logs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        setConsoleOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);

    let unlisten: (() => void) | null = null;
    if (isTauriEnv()) {
      void invoke<string[]>("get_backend_logs")
        .then((lines) => lines.forEach((l) => pushDebugLog("backend", "python", l)))
        .catch(() => {});
      void listen<string>("backend-log", (ev) => {
        pushDebugLog("backend", "python", ev.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    }

    return () => {
      window.removeEventListener("keydown", onKey);
      if (unlisten) unlisten();
    };
  }, []);

  // Initial boot sequence
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBootPct(25);
        setBootText(t("boot_bootstrap"));
        const apiUrl = await initApiBase();

        let bs: BootstrapResponse | null = null;
        let lastErr = "";
        for (let attempt = 0; attempt < 90; attempt++) {
          try {
            bs = await apiFetch<BootstrapResponse>("/api/bootstrap", lang);
            break;
          } catch (e) {
            lastErr = (e as Error)?.message || String(e);
            if (attempt > 2) {
              setBootText(`${t("boot_bootstrap")} (${attempt + 1}/90)`);
            }
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        if (cancelled) return;
        if (!bs) {
          setBootText(`Connection failed (${apiUrl}): ${lastErr || "timeout"}`);
          return;
        }

        const initMode: GameMode = bs.mode === "pve" ? "pve" : "regular";
        const initLang = bs.lang === "en" ? "en" : "ru";
        sharedStateRef.current.mode = initMode;
        sharedStateRef.current.lang = initLang;
        sharedStateRef.current.bootstrap = bs;
        setMode(initMode);
        setLang(initLang);
        setBootstrap(bs);
        setWatcher(bs.watcher);
        populateMapSelect(bs);

        setBootPct(70);
        setBootText(t("boot_quests"));
        await loadQuests(initMode, initLang, true);
        if (cancelled) return;

        setBootPct(100);
        setBootText(t("boot_ready"));
        window.setTimeout(() => {
          if (!cancelled) setBootVisible(false);
        }, 280);
      } catch (err) {
        if (!cancelled) {
          setBootVisible(false);
          showToast((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload active tab when tab / mode / lang / dataRev changes
  useEffect(() => {
    if (bootVisible) return;
    if (activeTab === "quests") {
      void loadQuests(mode, lang, false);
    } else if (activeTab === "quest-tree") {
      void treeEngineRef.current?.loadQuestTree(false);
    } else if (activeTab === "maps") {
      void mapsEngineRef.current?.loadMapView(sharedStateRef.current.currentMapNorm, false);
    }
  }, [activeTab, mode, lang, dataRev, bootVisible, loadQuests]);

  // Lightweight watcher status poll (paused when hidden)
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const bs = await apiFetch<BootstrapResponse>(`/api/bootstrap?mode=${mode}`, lang);
        setWatcher(bs.watcher);
      } catch {
        // Ignore transient poll errors
      }
    }, 12000);
    return () => window.clearInterval(id);
  }, [mode, lang]);

  const handleThemeChange = (next: ThemeConfig) => {
    const applied = applyThemeToDocument(next, true);
    setThemeState(applied);
    if (activeTab === "quest-tree") {
      treeEngineRef.current?.scheduleTreeFrame(true);
    }
  };

  const handleLangChange = async (nextLang: "ru" | "en") => {
    if (nextLang === lang) return;
    setLang(nextLang);
    sharedStateRef.current.lang = nextLang;
    try {
      localStorage.setItem("eft_assistant_lang", nextLang);
    } catch {
      // Ignore
    }
    invalidateDataCache(true);
    try {
      await apiFetch("/api/settings", nextLang, {
        method: "POST",
        body: JSON.stringify({ language: nextLang }),
      });
      const bs = await apiFetch<BootstrapResponse>(`/api/bootstrap?mode=${mode}`, nextLang);
      sharedStateRef.current.bootstrap = bs;
      setBootstrap(bs);
      setWatcher(bs.watcher);
      populateMapSelect(bs);
      showToast(nextLang === "en" ? "Language switched: English" : t("toast_lang_switched"));
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleModeChange = async (nextMode: GameMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    sharedStateRef.current.mode = nextMode;
    invalidateDataCache(false);
    try {
      const bs = await apiFetch<BootstrapResponse>(`/api/bootstrap?mode=${nextMode}`, lang);
      sharedStateRef.current.bootstrap = bs;
      setBootstrap(bs);
      setWatcher(bs.watcher);
      populateMapSelect(bs);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch("/api/sync", lang, { method: "POST", body: JSON.stringify({ mode, lang }) });
      invalidateDataCache(true);
      const bs = await apiFetch<BootstrapResponse>(`/api/bootstrap?mode=${mode}`, lang);
      sharedStateRef.current.bootstrap = bs;
      setBootstrap(bs);
      setWatcher(bs.watcher);
      populateMapSelect(bs);
      showToast(t("toast_synced"));
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveSettings = async (payload: Partial<BootstrapConfig>) => {
    try {
      await apiFetch("/api/settings", lang, { method: "POST", body: JSON.stringify(payload) });
      const bs = await apiFetch<BootstrapResponse>(`/api/bootstrap?mode=${mode}`, lang);
      sharedStateRef.current.bootstrap = bs;
      setBootstrap(bs);
      setWatcher(bs.watcher);
      showToast(t("toast_settings_saved"));
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleGuideSetStatus = async (taskId: string, status: "active" | "completed") => {
    try {
      await apiFetch("/api/quests/status", lang, {
        method: "POST",
        body: JSON.stringify({ mode, taskId, status }),
      });
      showToast(t("toast_status_updated"));
      invalidateDataCache(false);
      await loadQuests(mode, lang, true);
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const currentGuideTask = guideData ? questsData?.tasks?.find((x) => x.id === guideData.taskId) : undefined;

  return (
    <>
      <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <Sidebar
          mode={mode}
          onModeChange={handleModeChange}
          onLangChange={handleLangChange}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          watcher={watcher}
          themeBase={themeState.theme.base}
          themeAccent={themeState.theme.accent}
          syncing={syncing}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          onSync={handleSync}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenTheme={() => setThemeOpen(true)}
          onOpenConsole={() => setConsoleOpen(true)}
        />

        <main className="main-content">
          <AsciiShaderBg
            shaderMode={themeState.theme.shaderMode}
            activeTab={activeTab}
            accentRgb={themeState.accentRgb}
            accentBrightRgb={themeState.accentBrightRgb}
            isLight={themeState.isLight}
          />

          <QuestsTab
            active={activeTab === "quests"}
            mode={mode}
            data={questsData}
            loading={questsLoading}
            onOpenGuide={(id) => void openQuestGuide(id)}
            onStatusChanged={async () => {
              invalidateDataCache(false);
              await loadQuests(mode, lang, true);
            }}
            onModeSwitchFromImport={async (nextMode) => {
              setMode(nextMode);
              sharedStateRef.current.mode = nextMode;
            }}
            onToast={showToast}
          />

          <QuestTreeTab active={activeTab === "quest-tree"} />

          <MapsTab active={activeTab === "maps"} />

          <CultistTab
            active={activeTab === "cultist"}
            mode={mode}
            dataRev={dataRev}
            onToast={showToast}
          />

          <ItemsTab
            active={activeTab === "items"}
            mode={mode}
            dataRev={dataRev}
            onToast={showToast}
          />
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        config={bootstrap?.config}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      <ThemeModal
        open={themeOpen}
        theme={themeState.theme}
        textContrast={themeState.textContrast}
        accentContrast={themeState.accentContrast}
        onChange={handleThemeChange}
        onClose={() => setThemeOpen(false)}
      />

      <QuestGuideModal
        open={guideOpen}
        data={guideData}
        taskStatus={currentGuideTask?.status || "available"}
        hudText={guideHud}
        onClose={() => setGuideOpen(false)}
        onRefresh={(id) => void openQuestGuide(id, true)}
        onNavigateQuest={(id) => void openQuestGuide(id)}
        onSetStatus={(id, st) => void handleGuideSetStatus(id, st)}
      />

      <BootOverlay
        visible={bootVisible}
        progress={bootPct}
        stageText={bootText}
        onOpenConsole={() => setConsoleOpen(true)}
      />

      <DebugConsole open={consoleOpen} onClose={() => setConsoleOpen(false)} />

      <div className={`toast${toastMsg ? " show" : ""}`} id="toast" role="status" aria-live="polite">
        {toastMsg || ""}
      </div>
    </>
  );
};
