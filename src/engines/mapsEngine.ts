// @ts-nocheck
import { escHtml, fmtNum as fmtNumBase, fmtRub as fmtRubBase, GUIDE_BOOK_SVG } from "../utils/format";
import { getApiBaseSync } from "../api/client";

export interface EngineDeps {
  state: any;
  renderCache: any;
  api: (url: string, opts?: RequestInit) => Promise<any>;
  t: (key: string, vars?: Record<string, any> | null) => string;
  openQuestGuide: (taskId: string) => void;
  showToast: (msg: string) => void;
  invalidateDataCache: (clearMaps?: boolean) => void;
  ensureQuestsData: (force?: boolean) => Promise<any>;
}

export function createMapsEngine(deps: EngineDeps) {
  const { state, renderCache, api, t, openQuestGuide, showToast, invalidateDataCache } = deps;
  const esc = escHtml;
  const fmtNum = (n: unknown) => fmtNumBase(n, state.lang);
  const fmtRub = (n: unknown) => fmtRubBase(n, state.lang);
  const GUIDE_BOOK_ICO = GUIDE_BOOK_SVG;
  const GlyphLoader = {
    inline: (msg: string) => `<div class="muted" style="padding:12px;">${esc(msg)}</div>`,
    panelShader: (title: string, sub: string) =>
      `<div style="text-align:center;padding:24px;"><div style="font-weight:700;letter-spacing:0.06em;margin-bottom:6px;">${esc(title)}</div><div class="muted" style="font-size:12px;">${esc(sub)}</div></div>`,
  };
  const initAnimatedCheckboxes = (_root?: any) => {};
  const getTreeStatusLabel = (st: string) => {
    const map: Record<string, string> = {
      completed: t("status_completed"),
      active: t("status_active"),
      available: t("status_available"),
      locked: t("status_locked"),
      failed: t("status_failed"),
    };
    return map[st] || st || "—";
  };
document.querySelectorAll("[data-maptab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.maptab;
    document.querySelectorAll("[data-maptab]").forEach((b) => b.classList.toggle("active", b === btn));
    const layersEl = document.getElementById("mapSideLayers");
    const tasksEl = document.getElementById("mapSideTasks");
    if (layersEl) layersEl.dataset.open = target === "tasks" ? "false" : "true";
    if (tasksEl) tasksEl.dataset.open = target === "tasks" ? "true" : "false";
  });
});

document.getElementById("mapSelect").addEventListener("change", (e) => {
  state.currentMapNorm = e.target.value;
  state.focusedMapTaskId = null;
  state.selectedMapTaskIds.clear();
  state.mapTaskSearchQuery = "";
  const searchInput = document.getElementById("mapTaskSearch");
  if (searchInput) searchInput.value = "";
  loadMapView(state.currentMapNorm);
});

["layerExtractsPmc", "layerExtractsScav", "layerBosses", "layerLocks", "layerQuests", "layerCompletedQuests", "layerAllQuests", "layerPin"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", renderMapPins);
});

document.querySelectorAll("#mapTaskStatusTabs .map-status-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.mapTaskStatusFilter = btn.dataset.status || "active";
    document.querySelectorAll("#mapTaskStatusTabs .map-status-tab").forEach((b) => b.classList.toggle("active", b === btn));
    applyMapTaskFilter();
  });
});

try {
  state.mapVisualStyle = localStorage.getItem("eft_map_visual_style") === "satellite" ? "satellite" : "svg";
} catch {
  state.mapVisualStyle = "svg";
}

function updateMapStyleButtons() {
  const satAvailable = Boolean(state.currentMapData?.map?.satellite);
  document.querySelectorAll("#mapStyleSwitch [data-mapstyle]").forEach((btn) => {
    const mode = btn.dataset.mapstyle;
    if (mode === "satellite") {
      btn.disabled = !satAvailable;
      btn.title = satAvailable ? "" : t("map_sat_unavailable");
    }
    const effectiveMode = (state.mapVisualStyle === "satellite" && satAvailable) ? "satellite" : "svg";
    btn.classList.toggle("active", mode === effectiveMode);
  });
}

document.querySelectorAll("#mapStyleSwitch [data-mapstyle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mapstyle === "satellite" ? "satellite" : "svg";
    if (mode === "satellite" && !state.currentMapData?.map?.satellite) {
      showToast(t("map_sat_unavailable"));
      return;
    }
    state.mapVisualStyle = mode;
    try { localStorage.setItem("eft_map_visual_style", mode); } catch {}
    updateMapStyleButtons();
    applyMapVisualStyle();
  });
});

let satRenderToken = 0;

function renderSatelliteTiles(canvas, sat, token) {
  if (!canvas || !sat || !sat.tilePath || !sat.crop) return;
  const [cL, cT, cR, cB] = sat.crop;
  const cropW = cR - cL;
  const cropH = cB - cT;
  if (cropW <= 0 || cropH <= 0) return;

  const targetW = 1600;
  const targetH = Math.max(360, Math.round(targetW * (cropH / cropW)));
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0c0d0f";
  ctx.fillRect(0, 0, targetW, targetH);

  const drawZoomPass = (z, onDone) => {
    const n = 1 << z;
    const xMin = Math.max(0, Math.floor(cL * n));
    const xMax = Math.min(n - 1, Math.floor(cR * n));
    const yMin = Math.max(0, Math.floor(cT * n));
    const yMax = Math.min(n - 1, Math.floor(cB * n));
    const total = Math.max(1, (xMax - xMin + 1) * (yMax - yMin + 1));
    let done = 0;

    for (let ty = yMin; ty <= yMax; ty++) {
      for (let tx = xMin; tx <= xMax; tx++) {
        const rawUrl = sat.tilePath
          .replace("{z}", String(z))
          .replace("{x}", String(tx))
          .replace("{y}", String(ty));
        const img = new Image();
        img.crossOrigin = "anonymous";
        let retriedDirect = false;
        img.onload = () => {
          if (token !== satRenderToken) return;
          const dx = ((tx / n - cL) / cropW) * targetW;
          const dy = ((ty / n - cT) / cropH) * targetH;
          const dw = ((1 / n) / cropW) * targetW;
          const dh = ((1 / n) / cropH) * targetH;
          ctx.drawImage(img, dx, dy, dw + 0.6, dh + 0.6);
          done++;
          if (done >= total && onDone) onDone();
        };
        img.onerror = () => {
          if (!retriedDirect) {
            retriedDirect = true;
            img.src = rawUrl;
            return;
          }
          done++;
          if (done >= total && onDone) onDone();
        };
        img.src = `${getApiBaseSync()}/api/media-proxy?url=${encodeURIComponent(rawUrl)}`;
      }
    }
  };

  const zLow = Math.max(sat.minZoom || 1, Math.min(2, sat.maxZoom || 4));
  const zHigh = Math.max(zLow, Math.min(3, sat.maxZoom || 4));
  drawZoomPass(zLow, () => {
    if (token !== satRenderToken) return;
    if (zHigh > zLow) drawZoomPass(zHigh, null);
  });
}

function applyMapVisualStyle() {
  const svgLayer = document.getElementById("mapSvgLayer");
  const satCanvas = document.getElementById("mapSatCanvas");
  const sat = state.currentMapData?.map?.satellite;
  const useSat = state.mapVisualStyle === "satellite" && Boolean(sat);

  if (svgLayer) svgLayer.style.display = useSat ? "none" : "block";
  if (satCanvas) {
    satCanvas.style.display = useSat ? "block" : "none";
    if (useSat && satCanvas.dataset.renderedMap !== state.currentMapData?.map?.normalizedName) {
      satCanvas.dataset.renderedMap = state.currentMapData?.map?.normalizedName || "";
      satRenderToken += 1;
      renderSatelliteTiles(satCanvas, sat, satRenderToken);
    }
  }
  renderMapPins();
}

const mapSearchInput = document.getElementById("mapTaskSearch");
if (mapSearchInput) {
  mapSearchInput.addEventListener("input", (e) => {
    state.mapTaskSearchQuery = e.target.value.trim().toLowerCase();
    applyMapTaskFilter();
  });
  mapSearchInput.addEventListener("search", (e) => {
    state.mapTaskSearchQuery = e.target.value.trim().toLowerCase();
    applyMapTaskFilter();
  });
}

document.getElementById("btnResetTaskFilter")?.addEventListener("click", () => {
  clearMapTaskSelection();
});
document.getElementById("btnSelectAllTasks")?.addEventListener("click", () => {
  clearMapTaskSelection();
});
document.getElementById("mapRaidFilterBadge")?.addEventListener("click", () => {
  clearMapTaskSelection();
});

function clearMapTaskSelection() {
  state.selectedMapTaskIds.clear();
  state.focusedMapTaskId = null;
  syncMapTaskCardSelection();
  closeMapPinPopover();
  renderMapPins();
}

function focusMapCoordinates(u, v, minZoom = 1.35) {
  if (u == null || v == null) return;
  const vp = document.getElementById("mapViewport");
  const cv = document.getElementById("mapCanvas");
  if (vp && cv) {
    const cw = cv.offsetWidth || 1000;
    const ch = cv.offsetHeight || 620;
    state.mapZoom = Math.max(state.mapZoom, minZoom);
    state.mapPanX = vp.clientWidth / 2 - u * cw * state.mapZoom;
    state.mapPanY = vp.clientHeight / 2 - v * ch * state.mapZoom;
    applyMapTransform();
  }
}

function buildQuestPopoverHtml(task, singlePoint = null) {
  const statusLabels = {
    active: [t("status_active"), "green"],
    available: [t("status_available"), "blue"],
    completed: [t("status_completed"), "green"],
    locked: [t("status_locked"), ""],
    failed: [t("status_failed"), "red"],
  };
  const [stLbl, stCls] = statusLabels[task.status] || [task.status || "—", ""];
  const keysText = (task.neededKeys || []).map((k) => `${k.shortName || k.name}${k.price ? ` (${fmtRub(k.price)})` : ""}`).join(", ");
  const bodyRows = singlePoint
    ? (() => {
        const items = (singlePoint.neededItems || []).map((it) => `${it.name}${it.count > 1 ? ` ×${it.count}` : ""}`).join(", ");
        return `
          <div><b>${esc(t("map_goal_prefix"))}</b> ${esc(singlePoint.description || t("map_goal_default"))}</div>
          ${items ? `<div style="color:var(--accent-bright);font-size:11.5px;"><b>${esc(t("map_need_here"))}</b> ${esc(items)}</div>` : ""}
        `;
      })()
    : ((task.points || []).slice(0, 4).map((p) => {
        const items = (p.neededItems || []).map((it) => `${it.name}${it.count > 1 ? ` ×${it.count}` : ""}`).join(", ");
        return `<div>• ${esc(p.description || t("map_goal_default"))}${items ? ` <span style="color:var(--accent-bright);">[${esc(items)}]</span>` : ""}</div>`;
      }).join("") || `<div class="muted">${esc(t("map_quest_on_loc"))}</div>`);

  const doneBtn = task.status === "completed"
    ? `<button type="button" class="btn btn-ghost" style="padding:5px 9px;font-size:11.5px;" onclick="setMapQuestStatus('${esc(task.taskId)}','active')">${esc(t("tree_mark_active"))}</button>`
    : `<button type="button" class="btn btn-primary" style="padding:5px 9px;font-size:11.5px;" onclick="setMapQuestStatus('${esc(task.taskId)}','completed')">${esc(t("tree_mark_done"))}</button>`;

  return `
    <div class="map-popover-head">
      <div style="min-width:0;">
        <div class="map-popover-title">${esc(task.taskName)}</div>
        <div class="map-popover-meta">
          <span>${esc(task.traderName || "—")}</span>
          <span class="badge ${stCls}" style="font-size:10px;">${esc(stLbl)}</span>
          ${task.kappaRequired ? `<span class="badge amber" style="font-size:10px;">${esc(t("badge_kappa"))}</span>` : ""}
          ${task.lightkeeperRequired ? `<span class="badge" style="font-size:10px;">${esc(t("badge_lk"))}</span>` : ""}
        </div>
      </div>
      <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
    </div>
    <div class="map-popover-body">
      ${bodyRows}
      ${keysText ? `<div class="muted" style="font-size:11px;margin-top:2px;"><b>${esc(t("map_keys_prefix"))}</b> ${esc(keysText)}</div>` : ""}
    </div>
    <div class="map-popover-actions">
      <button type="button" class="btn-guide" onclick="openQuestGuide('${esc(task.taskId)}')">${GUIDE_BOOK_ICO}${esc(t("btn_guide_open"))}</button>
      ${doneBtn}
    </div>
  `;
}

window.setMapQuestStatus = async (taskId, status) => {
  await api("/api/quests/status", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, taskId, status }),
  });
  invalidateDataCache(true);
  closeMapPinPopover();
  await loadMapView(state.currentMapNorm, true);
  showToast(t("toast_status_updated"));
};

window.toggleSelectMapTask = (taskId, exclusive = false) => {
  if (exclusive) {
    if (state.selectedMapTaskIds.has(taskId) && state.selectedMapTaskIds.size === 1) {
      // Toggle off if already the sole selected quest
      state.selectedMapTaskIds.clear();
      state.focusedMapTaskId = null;
      closeMapPinPopover();
    } else {
      // Isolate this single quest and turn off others
      state.selectedMapTaskIds = new Set([taskId]);
      state.focusedMapTaskId = taskId;
      const qChk = document.getElementById("layerQuests");
      if (qChk && !qChk.checked) qChk.checked = true;

      const t = (state.currentMapData?.activeMapTasks || []).find((x) => x.taskId === taskId);
      if (t) {
        const firstPt = (t.points || []).find((p) => p.uv);
        if (firstPt) {
          focusMapCoordinates(firstPt.uv[0], firstPt.uv[1]);
          openMapPinPopover(firstPt.uv, buildQuestPopoverHtml(t, firstPt), null);
        } else {
          openMapPinPopover([0.5, 0.5], buildQuestPopoverHtml(t, null), null);
        }
      }
    }
  } else {
    // Multi-select toggle (checkbox)
    if (state.selectedMapTaskIds.has(taskId)) {
      state.selectedMapTaskIds.delete(taskId);
      if (state.focusedMapTaskId === taskId) state.focusedMapTaskId = null;
      if (state.selectedMapTaskIds.size === 0) closeMapPinPopover();
    } else {
      state.selectedMapTaskIds.add(taskId);
      state.focusedMapTaskId = taskId;
      const qChk = document.getElementById("layerQuests");
      if (qChk && !qChk.checked) qChk.checked = true;
      const t = (state.currentMapData?.activeMapTasks || []).find((x) => x.taskId === taskId);
      if (t) {
        const firstPt = (t.points || []).find((p) => p.uv);
        openMapPinPopover(firstPt ? firstPt.uv : [0.5, 0.5], buildQuestPopoverHtml(t, firstPt || null), null);
      }
    }
  }

  syncMapTaskCardSelection();
  renderMapPins();
};

function syncMapTaskCardSelection() {
  const host = document.getElementById("mapActiveTasksList");
  if (!host) return;
  const cards = host.querySelectorAll(".map-task-card");
  cards.forEach((card) => {
    const tid = card.dataset.taskId;
    const isSelected = state.selectedMapTaskIds.has(tid);
    card.classList.toggle("is-selected", isSelected);
    const cb = card.querySelector(".map-task-checkbox");
    if (cb) cb.checked = isSelected;
    const badge = card.querySelector(".map-selected-badge");
    if (badge) badge.style.display = isSelected ? "inline-flex" : "none";
  });
  const elSel = document.getElementById("countStSelected");
  if (elSel) elSel.textContent = String(state.selectedMapTaskIds.size);
  const total = cards.length;
  if (state.mapTaskStatusFilter === "selected") {
    applyMapTaskFilter();
    return;
  }
  const visible = Array.from(cards).filter((c) => c.style.display !== "none").length;
  updateMapTaskToolbar(total, visible);
}

function applyMapTaskFilter() {
  const query = (state.mapTaskSearchQuery || "").trim().toLowerCase();
  const statusFilter = state.mapTaskStatusFilter || "active";
  const host = document.getElementById("mapActiveTasksList");
  if (!host) return;
  const cards = host.querySelectorAll(".map-task-card");
  let visibleCount = 0;
  cards.forEach((card) => {
    const text = card.dataset.search || "";
    const st = card.dataset.status || "available";
    const tid = card.dataset.taskId;

    let statusMatches = true;
    if (statusFilter === "active") {
      statusMatches = (st === "active" || st === "available");
    } else if (statusFilter === "selected") {
      statusMatches = state.selectedMapTaskIds.has(tid);
    } else if (statusFilter === "completed") {
      statusMatches = (st === "completed");
    } else if (statusFilter === "locked") {
      statusMatches = (st === "locked" || st === "failed");
    }

    const searchMatches = !query || text.includes(query);
    const visible = statusMatches && searchMatches;
    card.style.display = visible ? "" : "none";
    if (visible) visibleCount++;
  });

  let noMatchEl = document.getElementById("mapTaskNoMatch");
  if (cards.length > 0 && visibleCount === 0) {
    if (!noMatchEl) {
      noMatchEl = document.createElement("div");
      noMatchEl.id = "mapTaskNoMatch";
      noMatchEl.className = "muted";
      noMatchEl.style.padding = "16px";
      noMatchEl.style.textAlign = "center";
      host.appendChild(noMatchEl);
    }
    noMatchEl.style.display = "";
    if (statusFilter === "selected" && !query && state.selectedMapTaskIds.size === 0) {
      noMatchEl.innerHTML = esc(t("map_selected_empty"));
    } else {
      noMatchEl.innerHTML = state.lang === "en"
        ? `No quests match «<b>${esc(query)}</b>».<br><button class="btn btn-ghost" style="margin-top:8px;font-size:11px;" onclick="clearMapTaskSearch()">Clear search</button>`
        : `По запросу «<b>${esc(query)}</b>» квестов не найдено.<br><button class="btn btn-ghost" style="margin-top:8px;font-size:11px;" onclick="clearMapTaskSearch()">Очистить поиск</button>`;
    }
  } else if (noMatchEl) {
    noMatchEl.style.display = "none";
  }

  updateMapTaskToolbar(cards.length, visibleCount);
}

window.clearMapTaskSearch = () => {
  const searchInput = document.getElementById("mapTaskSearch");
  if (searchInput) searchInput.value = "";
  state.mapTaskSearchQuery = "";
  applyMapTaskFilter();
  if (searchInput) searchInput.focus();
};

function updateMapTaskToolbar(totalCount, visibleCount) {
  const countEl = document.getElementById("mapTaskCount");
  const resetBtn = document.getElementById("btnResetTaskFilter");
  const raidBadge = document.getElementById("mapRaidFilterBadge");
  const tabBadge = document.getElementById("mapTasksTabBadge");
  const selCount = state.selectedMapTaskIds.size;

  if (countEl) {
    if (state.mapTaskSearchQuery) {
      countEl.textContent = state.lang === "en"
        ? `Found: ${visibleCount} of ${totalCount}${selCount ? ` (in raid: ${selCount})` : ""}`
        : `Найдено: ${visibleCount} из ${totalCount}${selCount ? ` (в рейде: ${selCount})` : ""}`;
    } else {
      countEl.textContent = selCount
        ? t("map_tasks_count_sel", { shown: totalCount, sel: selCount })
        : t("map_tasks_count", { shown: totalCount });
    }
  }

  if (tabBadge) {
    tabBadge.style.display = totalCount > 0 ? "inline-flex" : "none";
    tabBadge.textContent = selCount > 0 ? `${selCount}/${totalCount}` : String(totalCount);
    tabBadge.className = selCount > 0 ? "badge purple" : "badge";
  }

  if (resetBtn) {
    resetBtn.style.display = selCount > 0 ? "inline-flex" : "none";
  }

  if (raidBadge) {
    if (selCount > 0) {
      raidBadge.style.display = "inline-flex";
      if (selCount === 1) {
        const selId = Array.from(state.selectedMapTaskIds)[0];
        const selTask = (state.currentMapData?.activeMapTasks || []).find((x) => x.taskId === selId);
        const name = selTask?.taskName || (state.lang === "en" ? "1 quest" : "1 квест");
        raidBadge.textContent = state.lang === "en" ? `🎯 Raid: ${name} ✕` : `🎯 Вылазка: ${name} ✕`;
      } else {
        raidBadge.textContent = t("map_raid_badge", { n: selCount });
      }
    } else {
      raidBadge.style.display = "none";
    }
  }
}

async function loadMapView(norm, force = false) {
  const mapSig = `${state.mode}:${state.lang}:${norm}:${state.dataRev}`;
  if (!force && renderCache.mapsSig === mapSig && state.currentMapData?.map?.normalizedName === norm) {
    return;
  }
  if (state.lastLoadedMapNorm !== norm) {
    state.selectedMapTaskIds.clear();
    state.focusedMapTaskId = null;
    state.mapTaskSearchQuery = "";
    const searchInput = document.getElementById("mapTaskSearch");
    if (searchInput) searchInput.value = "";
    state.lastLoadedMapNorm = norm;
  }

  let data = !force ? renderCache.mapsDataByKey.get(mapSig) : null;
  const svgHost = document.getElementById("mapSvgHost");
  if (!data) {
    if (!state.currentMapData || state.currentMapData.map?.normalizedName !== norm) {
      if (svgHost) {
        svgHost.innerHTML = `<div style="width:900px;height:520px;display:flex;align-items:center;justify-content:center;">${GlyphLoader.panelShader(state.lang === "en" ? "SCANNING LOCATION" : "СКАНИРОВАНИЕ ЛОКАЦИИ", state.lang === "en" ? "Loading map SVG, extracts and quest markers..." : "Загрузка схемы, выходов и квестовых меток...")}</div>`;
      }
      const bossHost = document.getElementById("mapBossList");
      if (bossHost) bossHost.innerHTML = GlyphLoader.inline(state.lang === "en" ? "Loading intel..." : "Чтение разведданных...");
    }
    data = await api(`/api/maps/${norm}?mode=${state.mode}`);
    renderCache.mapsDataByKey.set(mapSig, data);
  }
  renderCache.mapsSig = mapSig;
  state.currentMapData = data;
  const mp = data.map;
  document.getElementById("mapTitle").textContent = mp.name;
  const pmcExCnt = (mp.extracts || []).filter((e) => (e.faction || "").toLowerCase() === "pmc").length;
  const scavExCnt = (mp.extracts || []).filter((e) => (e.faction || "").toLowerCase() === "scav").length;
  const sharedExCnt = (mp.extracts || []).length - pmcExCnt - scavExCnt;
  document.getElementById("mapMeta").textContent = t("map_meta_fmt", {
    dur: mp.raidDuration,
    players: mp.players || "—",
    pmc: pmcExCnt,
    scav: scavExCnt,
    shared: sharedExCnt ? t("map_meta_shared", { n: sharedExCnt }) : "",
    locks: mp.locks.length,
  });

  // Boss list
  const bossHost = document.getElementById("mapBossList");
  bossHost.innerHTML = mp.bosses.length
    ? mp.bosses.map((b) => `
        <div class="list-row">
          <div><b>${esc(b.name)}</b><div class="muted">${(b.spawnLocations || []).map((s) => `${esc(s.name)} (${s.chance}%)`).join(", ") || esc(t("map_boss_spawn_any"))}</div></div>
          <span class="badge ${b.chance >= 30 ? "amber" : ""}">${b.chance}%</span>
        </div>
      `).join("")
    : `<div class="muted">${esc(t("map_bosses_empty"))}</div>`;

  // Active tasks & required items for this map
  renderMapActiveTasks(data.activeMapTasks || []);

  // Render SVG + optional Satellite layer
  const svgHtml = data.svg
    ? data.svg
    : `<div style="width:1000px;height:620px;display:flex;align-items:center;justify-content:center;color:#71717a;">${esc(t("map_no_svg", { name: mp.name }))}</div>`;
  svgHost.innerHTML = `<div id="mapSvgLayer">${svgHtml}</div><canvas id="mapSatCanvas" class="map-sat-canvas" style="display:none;"></canvas>`;
  const svgEl = svgHost.querySelector("svg");
  if (svgEl) {
    svgEl.style.width = "1000px";
    svgEl.style.height = "auto";
    svgEl.style.display = "block";
  }
  updateMapStyleButtons();
  applyMapVisualStyle();

  // Floors selector (multi-floor SVG groups & height tiers across all maps)
  state.activeMapFloor = "all";
  state.selectedLockPinId = null;
  closeMapPinPopover();
  const floorsWrap = document.getElementById("mapFloorsWrap");
  const floorsHost = document.getElementById("mapFloors");
  const floorsList = mp.floors || [];
  if (floorsList.length) {
    floorsWrap.style.display = "flex";
    floorsHost.innerHTML = `<button class="floor-chip active" data-floor="all">${esc(t("map_all_floors"))}</button>` +
      floorsList.map((f) => `<button class="floor-chip" data-floor="${esc(f.id)}">${esc(f.label)}</button>`).join("");
  } else {
    floorsWrap.style.display = "none";
  }

  resetMapTransform();
  renderMapPins();
}

function renderMapActiveTasks(tasks) {
  const host = document.getElementById("mapActiveTasksList");
  if (!host) return;

  const countActive = tasks.filter((t) => t.status === "active" || t.status === "available").length;
  const countComp = tasks.filter((t) => t.status === "completed").length;
  const countLocked = tasks.filter((t) => t.status === "locked" || t.status === "failed").length;
  const countAll = tasks.length;

  const elAct = document.getElementById("countStActive");
  if (elAct) elAct.textContent = countActive;
  const elSel = document.getElementById("countStSelected");
  if (elSel) elSel.textContent = String(state.selectedMapTaskIds.size);
  const elComp = document.getElementById("countStCompleted");
  if (elComp) elComp.textContent = countComp;
  const elLoc = document.getElementById("countStLocked");
  if (elLoc) elLoc.textContent = countLocked;
  const elAll = document.getElementById("countStAll");
  if (elAll) elAll.textContent = countAll;

  const tabBadge = document.getElementById("mapTasksTabBadge");
  if (tabBadge) {
    tabBadge.textContent = countActive;
    tabBadge.style.display = countActive > 0 ? "inline-block" : "none";
  }

  if (!tasks.length) {
    host.innerHTML = `<div class="muted">${esc(t("map_tasks_empty"))}</div>`;
    updateMapTaskToolbar(0, 0);
    return;
  }

  const statusBadgeMap = {
    active: `<span class="badge green">${esc(t("status_active"))}</span>`,
    available: `<span class="badge blue">${esc(t("status_available"))}</span>`,
    completed: `<span class="badge green">${esc(t("status_completed_mark"))}</span>`,
    locked: `<span class="badge muted">${esc(t("status_locked_long"))}</span>`,
    failed: `<span class="badge red">${esc(t("status_failed"))}</span>`,
  };

  host.innerHTML = tasks.map((t) => {
    const isSelected = state.selectedMapTaskIds.has(t.taskId);
    const searchStr = `${t.taskName} ${t.traderName || ""} ${(t.points || []).map((p) => p.description || "").join(" ")}`.toLowerCase();
    const keysHtml = (t.neededKeys || []).length
      ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span class="muted" style="font-size:11px;">${esc(window.t("map_keys_prefix"))}</span>${t.neededKeys.map((k) => `<span class="badge" style="font-size:11px;">🔑 ${esc(k.shortName || k.name)}${k.price ? ` (${fmtRub(k.price)})` : ""}</span>`).join("")}</div>`
      : "";
    const ptsHtml = (t.points || []).map((p, idx) => {
      const itemsHtml = (p.neededItems || []).length
        ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${p.neededItems.map((it) => `<span class="badge amber" style="font-size:11px;">${((it.kind || "").toLowerCase().includes("маркер") || (it.kind || "").toLowerCase().includes("marker")) ? "📡 " : "📦 "}${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ""}</span>`).join("")}</div>`
        : "";
      const focusBtn = p.uv
        ? `<button class="btn btn-ghost" style="padding:2px 6px;font-size:11px;flex-shrink:0;" onclick="event.stopPropagation(); focusMapPoint('${esc(t.taskId)}', ${p.uv[0]}, ${p.uv[1]}, ${idx})">${esc(window.t("map_on_map"))}</button>`
        : `<span class="muted" style="font-size:11px;">${esc(window.t("map_no_point"))}</span>`;
      return `
        <div class="map-task-point" onclick="event.stopPropagation();">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div style="font-size:12px;line-height:1.3;">${esc(p.description || window.t("map_goal_default"))}</div>
            ${focusBtn}
          </div>
          ${itemsHtml}
        </div>
      `;
    }).join("");

    const stBadge = statusBadgeMap[t.status] || `<span class="badge">${esc(t.status)}</span>`;
    const cardCls = [
      "map-task-card",
      isSelected ? "is-selected" : "",
      t.status === "completed" ? "is-completed" : "",
      (t.status === "locked" || t.status === "failed") ? "is-locked" : "",
    ].filter(Boolean).join(" ");

    return `
      <div class="${cardCls}" data-task-id="${esc(t.taskId)}" data-status="${esc(t.status)}" data-search="${esc(searchStr)}" onclick="toggleSelectMapTask('${esc(t.taskId)}', false)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <input type="checkbox" class="map-task-checkbox" data-task-id="${esc(t.taskId)}" ${isSelected ? "checked" : ""} title="${esc(window.t("map_multiselect_title"))}" onclick="event.stopPropagation(); toggleSelectMapTask('${esc(t.taskId)}', false);" />
            <b class="map-task-title">${esc(t.taskName)}</b>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;align-items:center;">
            <button type="button" class="btn-guide compact" title="${esc(window.t("btn_guide_title"))}" onclick="event.stopPropagation(); openQuestGuide('${esc(t.taskId)}')">${GUIDE_BOOK_ICO}${esc(window.t("btn_guide"))}</button>
            ${t.kappaRequired ? `<span class="badge amber">${esc(window.t("badge_kappa"))}</span>` : ""}
            ${t.lightkeeperRequired ? `<span class="badge">${esc(window.t("badge_lk"))}</span>` : ""}
            ${stBadge}
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
          <span class="muted" style="font-size:12px;">${esc(window.t("map_trader_prefix"))} <b>${esc(t.traderName || "—")}</b></span>
          <span class="badge purple map-selected-badge" style="font-size:10px;display:${isSelected ? "inline-flex" : "none"};">${esc(window.t("map_selected_raid"))}</span>
        </div>
        ${keysHtml}
        ${ptsHtml}
      </div>
    `;
  }).join("");

  applyMapTaskFilter();
  initAnimatedCheckboxes(document.getElementById("mapActiveTasksList"));
}

window.focusMapPoint = (taskId, u, v, ptIdx) => {
  state.focusedMapTaskId = taskId;
  state.selectedMapTaskIds.add(taskId);
  const qChk = document.getElementById("layerQuests");
  if (qChk && !qChk.checked) qChk.checked = true;
  syncMapTaskCardSelection();
  renderMapPins();
  focusMapCoordinates(u, v, 1.4);

  const t = (state.currentMapData?.activeMapTasks || []).find((x) => x.taskId === taskId);
  const pt = t?.points?.[ptIdx];
  if (t) {
    openMapPinPopover([u, v], buildQuestPopoverHtml(t, pt || null), null);
  }
};

window.setActiveMapFloor = function setActiveMapFloor(floorId) {
  const nextFloor = floorId || "all";
  state.activeMapFloor = nextFloor;
  document.querySelectorAll("#mapFloors .floor-chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.floor === nextFloor);
  });

  const floorsList = state.currentMapData?.map?.floors || [];
  const floorObj = floorsList.find((f) => f.id === nextFloor);
  const svgEl = document.querySelector("#mapSvgHost svg");
  if (svgEl) {
    const groups = svgEl.querySelectorAll(":scope > g[id]");
    if (nextFloor === "all" || !floorObj) {
      groups.forEach((g) => {
        g.style.opacity = "1";
        g.style.pointerEvents = "";
      });
    } else {
      const targetIds = new Set((floorObj.svgIds || []).map((s) => s.toLowerCase()));
      const isolated = Boolean(floorObj.isolated);
      let anyTargetInSvg = false;
      groups.forEach((g) => {
        if (targetIds.has(g.id.toLowerCase())) anyTargetInSvg = true;
      });
      groups.forEach((g) => {
        const gid = g.id.toLowerCase();
        const isMatch = targetIds.has(gid);
        const isBase = gid === "ground_level" || gid === "ground_floor";
        if (!anyTargetInSvg) {
          // Map has virtual height floors over a single base SVG layer (e.g. Reserve 2nd-5th)
          g.style.opacity = isBase ? "1" : "0.14";
          g.style.pointerEvents = "";
        } else if (isMatch) {
          g.style.opacity = "1";
          g.style.pointerEvents = "";
        } else if (!isolated && isBase) {
          g.style.opacity = "0.28";
          g.style.pointerEvents = "none";
        } else {
          g.style.opacity = isolated ? "0.08" : "0.12";
          g.style.pointerEvents = "none";
        }
      });
    }
  }

  document.querySelectorAll("#mapPinsHost .map-pin.pin-lock, #mapPinsHost .map-pin-anchor.pin-lock, #mapPinsHost .map-leader.pin-lock").forEach((pinEl) => {
    const pinFloor = pinEl.dataset.floorId || "";
    const dim = nextFloor !== "all" && pinFloor && pinFloor !== nextFloor;
    pinEl.classList.toggle("is-dimmed-floor", dim);
  });
};

document.getElementById("mapFloors").addEventListener("click", (e) => {
  const btn = e.target.closest(".floor-chip");
  if (!btn) return;
  setActiveMapFloor(btn.dataset.floor);
});

function getPinAccentColor(cls) {
  if (!cls) return "#cbd5e1";
  if (cls.includes("pin-quest-done")) return "#6b7280";
  if (cls.includes("pin-quest-future")) return "#94a3b8";
  if (cls.includes("pin-quest")) return "#a855f7";
  if (cls.includes("pin-extract-scav")) return "#0ea5e9";
  if (cls.includes("pin-extract-shared")) return "#14b8a6";
  if (cls.includes("pin-extract")) return "#22c55e";
  if (cls.includes("pin-boss")) return "#ef4444";
  if (cls.includes("pin-lock")) return "#ec4899";
  if (cls.includes("pin-player")) return "#f59e0b";
  return "#cbd5e1";
}

function getPinPriority(p) {
  const cls = p.cls || "";
  if (cls.includes("pin-player")) return 100;
  if (cls.includes("pin-quest-cluster") || cls === "pin-quest") return 90;
  if (cls.includes("pin-boss")) return 80;
  if (cls.includes("pin-extract")) return 70;
  if (cls.includes("pin-quest-future") || cls.includes("pin-quest-done")) return 55;
  if (cls.includes("pin-lock")) return 40;
  return 50;
}

function stripPinHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function layoutCalloutPins(pins, mapW, mapH) {
  const placedLabels = [];
  const anchorDots = [];
  const items = pins.map((p, idx) => {
    const ax = (p.left / 100) * mapW;
    const ay = (p.top / 100) * mapH;
    const isPlayer = (p.cls || "").includes("pin-player");
    const text = stripPinHtml(p.label);
    const boxW = Math.min(220, Math.max(46, Math.round(text.length * 5.6 + 16)));
    const boxH = 19;
    if (!isPlayer) {
      anchorDots.push({ idx, x1: ax - 5, y1: ay - 5, x2: ax + 5, y2: ay + 5 });
    }
    return { p, idx, ax, ay, boxW, boxH, isPlayer, prio: getPinPriority(p) };
  });

  const order = items
    .filter((it) => !it.isPlayer)
    .sort((a, b) => (b.prio - a.prio) || (a.ay - b.ay) || (a.ax - b.ax));

  const rectsOverlap = (a, b, pad = 3) =>
    !(a.x2 + pad <= b.x1 || a.x1 >= b.x2 + pad || a.y2 + pad <= b.y1 || a.y1 >= b.y2 + pad);

  const overlapArea = (a, b) => {
    const ox = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    const oy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    return ox * oy;
  };

  const cellCounts = new Map();

  order.forEach((it) => {
    const { p, idx, ax, ay, boxW, boxH } = it;
    const cellKey = `${Math.round(ax / 28)}:${Math.round(ay / 28)}`;
    const cellIdx = cellCounts.get(cellKey) || 0;
    cellCounts.set(cellKey, cellIdx + 1);

    let preferRight = ax < mapW * 0.78;
    if (ax > 160 && ax < mapW - 160) {
      preferRight = cellIdx % 2 === 0;
    }

    const candidates = [];
    for (let ring = 0; ring <= 6; ring++) {
      const dxBase = 16 + ring * 12;
      const yOffsets = ring === 0 ? [0] : [-ring * 22, ring * 22];
      const sides = preferRight ? [1, -1] : [-1, 1];
      for (const dy of yOffsets) {
        for (const side of sides) {
          if (ring === 0 && side === -1 && ax < boxW + 22) continue;
          if (ring === 0 && side === 1 && ax + boxW + 22 > mapW) continue;
          const rawLeft = side === 1 ? ax + dxBase : ax - dxBase - boxW;
          const boxLeft = Math.max(4, Math.min(mapW - boxW - 4, rawLeft));
          const boxCenterY = Math.max(boxH / 2 + 4, Math.min(mapH - boxH / 2 - 4, ay + dy));
          const rect = {
            x1: boxLeft,
            y1: boxCenterY - boxH / 2,
            x2: boxLeft + boxW,
            y2: boxCenterY + boxH / 2,
          };
          candidates.push({ boxLeft, boxCenterY, rect, side });
        }
      }
    }

    let chosen = null;
    let fallbackNoLabelHit = null;
    let bestOverlap = Infinity;
    let bestCandidate = candidates[0];

    for (const c of candidates) {
      const hitsLabel = placedLabels.some((r) => rectsOverlap(c.rect, r, 3));
      if (!hitsLabel) {
        const hitsDot = anchorDots.some((d) => d.idx !== idx && rectsOverlap(c.rect, d, 2));
        if (!hitsDot) {
          chosen = c;
          break;
        }
        if (!fallbackNoLabelHit) fallbackNoLabelHit = c;
      } else {
        let area = 0;
        for (const r of placedLabels) area += overlapArea(c.rect, r);
        if (area < bestOverlap) {
          bestOverlap = area;
          bestCandidate = c;
        }
      }
    }

    const pick = chosen || fallbackNoLabelHit || bestCandidate;
    placedLabels.push(pick.rect);

    const boxCenterX = pick.boxLeft + boxW / 2;
    const isRight = boxCenterX >= ax;
    const lx = isRight ? pick.boxLeft : pick.boxLeft + boxW;
    const ly = pick.boxCenterY;

    let pointsStr;
    let leaderLen;
    if (Math.abs(ly - ay) <= 2 || Math.abs(lx - ax) <= 6) {
      pointsStr = `${ax.toFixed(1)},${ay.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}`;
      leaderLen = Math.ceil(Math.hypot(lx - ax, ly - ay)) + 2;
    } else {
      const horizDist = Math.abs(lx - ax);
      const step = Math.min(horizDist * 0.55, Math.max(8, Math.abs(ly - ay)));
      const ex = isRight ? Math.max(ax, lx - step) : Math.min(ax, lx + step);
      pointsStr = `${ax.toFixed(1)},${ay.toFixed(1)} ${ex.toFixed(1)},${ly.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}`;
      leaderLen = Math.ceil(Math.hypot(ex - ax, ly - ay) + Math.abs(lx - ex)) + 2;
    }

    p._callout = {
      ax,
      ay,
      isRight,
      leaderLen,
      boxLeftPct: (pick.boxLeft / mapW) * 100,
      boxTopPct: (pick.boxCenterY / mapH) * 100,
      pointsStr,
      accent: getPinAccentColor(p.cls),
      groupId: "",
      staggerIdx: 0,
      groupSize: 1,
    };
  });

  // Group nearby anchor dots (within 16px) so hovering one fans out the whole co-located group
  const calloutItems = items.filter((it) => !it.isPlayer && it.p._callout);
  const groups = [];
  for (const it of calloutItems) {
    let targetGroup = null;
    for (const g of groups) {
      if (Math.hypot(it.ax - g.cx, it.ay - g.cy) <= 16) {
        targetGroup = g;
        break;
      }
    }
    if (!targetGroup) {
      groups.push({ cx: it.ax, cy: it.ay, members: [it] });
    } else {
      targetGroup.members.push(it);
      const n = targetGroup.members.length;
      targetGroup.cx = (targetGroup.cx * (n - 1) + it.ax) / n;
      targetGroup.cy = (targetGroup.cy * (n - 1) + it.ay) / n;
    }
  }

  groups.forEach((g, gi) => {
    const groupId = `g${gi}`;
    const size = g.members.length;
    g.members.forEach((it, si) => {
      it.p._callout.groupId = groupId;
      it.p._callout.staggerIdx = si;
      it.p._callout.groupSize = size;
    });
  });
}

function renderMapPins() {
  const pinsHost = document.getElementById("mapPinsHost");
  if (!state.currentMapData) return;
  if (typeof cancelHideRevealedGroup === "function") cancelHideRevealedGroup();
  revealedGroupId = null;
  const { map, questMarkers, lastPin } = state.currentMapData;
  const showPmcExtracts = document.getElementById("layerExtractsPmc")?.checked ?? true;
  const showScavExtracts = document.getElementById("layerExtractsScav")?.checked ?? true;
  const showBosses = document.getElementById("layerBosses").checked;
  const showLocks = document.getElementById("layerLocks").checked;
  const showQuests = document.getElementById("layerQuests")?.checked ?? true;
  const showCompletedQuests = document.getElementById("layerCompletedQuests")?.checked ?? false;
  const showAllQuests = document.getElementById("layerAllQuests")?.checked ?? false;
  const showPin = document.getElementById("layerPin").checked;

  const pins = [];
  const addPin = (uv, cls, label, detailHtml, taskId = null, tooltipHtml = "", extra = null) => {
    if (!uv) return;
    const left = Math.max(1, Math.min(99, uv[0] * 100));
    const top = Math.max(1, Math.min(99, uv[1] * 100));
    pins.push({ uv, left, top, cls, label, detailHtml, taskId, tooltipHtml, ...(extra || {}) });
  };

  if (showPmcExtracts || showScavExtracts) {
    map.extracts.forEach((ex) => {
      const rawFaction = (ex.faction || "shared").toLowerCase();
      const isScavOnly = rawFaction === "scav";
      const isPmcOnly = rawFaction === "pmc";
      const isShared = !isScavOnly && !isPmcOnly;
      const visible = (isPmcOnly && showPmcExtracts)
        || (isScavOnly && showScavExtracts)
        || (isShared && (showPmcExtracts || showScavExtracts));
      if (!visible) return;

      const cls = isScavOnly ? "pin-extract-scav" : (isShared ? "pin-extract-shared" : "pin-extract");
      const factionLabel = isScavOnly ? t("map_extract_scav") : (isShared ? t("map_extract_shared") : t("map_extract_pmc"));
      const badgeCls = isScavOnly ? "blue" : (isShared ? "amber" : "green");
      const titleCol = isScavOnly ? "#38bdf8" : (isShared ? "#2dd4bf" : "#4ade80");
      const reqTag = ex.requirement || (ex.switch ? t("map_extract_switch") : "");
      const reqDesc = ex.description || (ex.switch ? t("map_extract_switch") : t("map_extract_no_cond"));
      const tooltipHtml = `
        <div class="map-tooltip-header">
          <div class="map-tooltip-title" style="color:${titleCol};">${esc(ex.name)}</div>
          <span class="badge ${badgeCls}" style="font-size:10px;">${esc(factionLabel)}</span>
        </div>
        <div class="map-tooltip-body">
          <div>${esc(t("map_extract_label"))} <b>${esc(factionLabel)}</b></div>
          ${reqTag ? `<div style="margin-top:4px;"><span class="badge amber" style="font-size:10px;">${esc(reqTag)}</span></div>` : ""}
          <div class="muted" style="font-size:11px;margin-top:4px;line-height:1.35;">${esc(reqDesc)}</div>
        </div>
        <div class="map-tooltip-footer">
          <span>${esc(t("map_extract_foot"))}</span>
        </div>
      `;
      const detailHtml = `
        <div class="map-popover-head">
          <div style="min-width:0;">
            <div class="map-popover-title" style="color:${titleCol};">${esc(ex.name)}</div>
            <div class="map-popover-meta">
              <span class="badge ${badgeCls}" style="font-size:10px;">${esc(factionLabel)}</span>
              ${reqTag ? `<span class="badge amber" style="font-size:10px;">${esc(reqTag)}</span>` : ""}
            </div>
          </div>
          <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
        </div>
        <div class="map-popover-body">
          <div>${esc(t("map_faction_prefix"))} <b>${esc(factionLabel)}</b></div>
          <div style="color:${reqTag ? "var(--text)" : "var(--text-muted)"};font-size:12px;line-height:1.45;">
            ${reqTag ? `<b>${esc(t("map_extract_req"))}</b> ` : ""}${esc(reqDesc)}
          </div>
        </div>
      `;
      addPin(ex.uv, cls, ex.name, detailHtml, null, tooltipHtml);
    });
  }
  if (showLocks) {
    map.locks.forEach((lk) => {
      const lbl = lk.keyShortName || lk.keyName || (state.lang === "en" ? "Door" : "Дверь");
      const fId = lk.floorId || "first";
      const fLbl = lk.floorLabel || (state.lang === "en" ? "1st Floor / Ground" : "1 этаж / Улица");
      const tooltipHtml = `
        <div class="map-tooltip-header">
          <div class="map-tooltip-title" style="color:var(--accent-bright);">${esc(t("map_key_prefix"))} ${esc(lbl)}</div>
          <span class="badge amber" style="font-size:10px;">${fmtRub(lk.keyPrice)}</span>
        </div>
        <div class="map-tooltip-body">
          <div><b>${esc(t("map_key_prefix"))}</b> ${esc(lk.keyName || "—")}</div>
          <div style="margin-top:3px;"><span class="badge" style="font-size:10px;">${esc(t("map_floor_prefix"))} ${esc(fLbl)}</span></div>
          ${lk.needsPower ? `<div style="color:var(--accent-bright);margin-top:3px;">${esc(t("map_needs_power"))}</div>` : ""}
        </div>
        <div class="map-tooltip-footer">
          <span>${esc(t("map_key_foot"))}</span>
        </div>
      `;
      const detailHtml = `
        <div class="map-popover-head">
          <div style="min-width:0;">
            <div class="map-popover-title" style="color:var(--accent-bright);">${esc(lbl)}</div>
            <div class="map-popover-meta">
              <span class="badge amber" style="font-size:10px;">${esc(t("map_floor_prefix"))} ${esc(fLbl)}</span>
              ${lk.keyPrice ? `<span>${fmtRub(lk.keyPrice)}</span>` : ""}
            </div>
          </div>
          <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
        </div>
        <div class="map-popover-body">
          <div><b>${esc(t("map_key_prefix"))}</b> ${esc(lk.keyName || "—")}</div>
          <div class="muted" style="font-size:11.5px;">${esc(t("map_key_price"))} ${fmtRub(lk.keyPrice)}${lk.needsPower ? ` • ${esc(t("map_needs_power"))}` : ""}</div>
        </div>
        <div class="map-popover-actions">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:11.5px;" onclick="setActiveMapFloor('all')">${esc(t("map_show_all_floors"))}</button>
        </div>
      `;
      addPin(lk.uv, "pin-lock", `${esc(lbl)}`, detailHtml, null, tooltipHtml, { floorId: fId, floorLabel: fLbl, lockId: lk.id });
    });
  }
  if (showQuests || showCompletedQuests || showAllQuests) {
    const hasSelection = state.selectedMapTaskIds && state.selectedMapTaskIds.size > 0;
    const taskLookup = new Map((state.currentMapData?.activeMapTasks || []).map((t) => [t.taskId, t]));
    const visibleQuests = [];

    (questMarkers || []).forEach((qm) => {
      if (!qm.uv) return;
      const isActive = qm.status === "active" || qm.status === "available";
      const isCompleted = qm.status === "completed";
      const isLocked = qm.status === "locked" || qm.status === "failed";
      const isExplicitlyFocused = qm.taskId === state.focusedMapTaskId || (state.selectedMapTaskIds && state.selectedMapTaskIds.has(qm.taskId));

      if (!isExplicitlyFocused) {
        if (isActive && !showQuests) return;
        if (isCompleted && !showCompletedQuests) return;
        if (isLocked && !showAllQuests) return;
        if (!isActive && !isCompleted && !isLocked && !showAllQuests) return;
      }
      if (hasSelection && !state.selectedMapTaskIds.has(qm.taskId)) return;
      visibleQuests.push(qm);
    });

    // Cluster overlapping quest markers within 0.008 UV radius (only when >= 4)
    const clusters = [];
    for (let i = 0; i < visibleQuests.length; i++) {
      const qm = visibleQuests[i];
      let target = null;
      for (let j = 0; j < clusters.length; j++) {
        const cl = clusters[j];
        if (Math.hypot(qm.uv[0] - cl.uv[0], qm.uv[1] - cl.uv[1]) < 0.008) {
          target = cl;
          break;
        }
      }
      if (!target) {
        clusters.push({ uv: [qm.uv[0], qm.uv[1]], items: [qm] });
      } else {
        target.items.push(qm);
        const n = target.items.length;
        target.uv = [
          (target.uv[0] * (n - 1) + qm.uv[0]) / n,
          (target.uv[1] * (n - 1) + qm.uv[1]) / n,
        ];
      }
    }

    clusters.forEach((cl) => {
      const items = cl.items;
      if (items.length < 4) {
        items.forEach((qm) => {
        const isActive = qm.status === "active" || qm.status === "available";
        const isCompleted = qm.status === "completed";
        const isLocked = qm.status === "locked" || qm.status === "failed";
        const isSelected = hasSelection && state.selectedMapTaskIds.has(qm.taskId);
        let cls = "pin-quest";
        if (isCompleted) cls = "pin-quest-completed";
        else if (isLocked) cls = "pin-quest-other";
        if (isSelected) cls += " is-highlighted";

        const itemsText = (qm.neededItems || []).map((it) => `${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ""}`).join(", ");
        const stTxt = getTreeStatusLabel(qm.status);
        const stBadgeColor = isCompleted ? "green" : (isActive ? (qm.status === "active" ? "green" : "blue") : "");
        const tooltipTitleColor = isCompleted ? "#34d399" : (isActive ? "#c084fc" : "#a1a1aa");

        const tooltipHtml = `
          <div class="map-tooltip-header">
            <div>
              <div class="map-tooltip-title" style="color:${tooltipTitleColor};">${esc(qm.taskName)}${isCompleted ? ` (${t("status_completed")})` : ""}</div>
              <div class="muted" style="font-size:11px;">${esc(t("map_trader_prefix"))} ${esc(qm.traderName || "—")}</div>
            </div>
            <div style="display:flex;gap:4px;">
              ${qm.kappaRequired ? `<span class="badge amber" style="font-size:10px;">${esc(t("badge_kappa"))}</span>` : ""}
              <span class="badge ${stBadgeColor}" style="font-size:10px;">${esc(stTxt)}</span>
            </div>
          </div>
          <div class="map-tooltip-body">
            <div style="margin-bottom:3px;"><b>${esc(t("map_goal_prefix"))}</b> ${esc(qm.description || t("map_goal_default"))}</div>
            ${itemsText ? `<div style="color:var(--accent-bright);font-size:11px;margin-top:4px;"><b>${esc(t("map_need_here"))}</b> ${itemsText}</div>` : ""}
          </div>
          <div class="map-tooltip-footer">
            <span>${esc(t("map_quest_foot_l"))}</span>
            <span style="color:var(--accent-bright);font-weight:600;">${esc(t("map_quest_foot_r"))}</span>
          </div>
        `;

        const fullTask = taskLookup.get(qm.taskId) || {
          taskId: qm.taskId,
          taskName: qm.taskName,
          traderName: qm.traderName,
          status: qm.status,
          kappaRequired: qm.kappaRequired,
          lightkeeperRequired: qm.lightkeeperRequired,
          neededKeys: [],
          points: [],
        };
        const detailHtml = buildQuestPopoverHtml(fullTask, qm);

        addPin(
          cl.uv,
          cls,
          `${esc(qm.taskName)}${isCompleted ? " ✓" : ""}`,
          detailHtml,
          qm.taskId,
          tooltipHtml
        );
        });
        return;
      }

      // Multi-quest cluster pin
      const anyActive = items.some((x) => x.status === "active" || x.status === "available");
      const allCompleted = items.every((x) => x.status === "completed");
      const anySelected = hasSelection && items.some((x) => state.selectedMapTaskIds.has(x.taskId));
      let cls = anyActive ? "pin-quest pin-quest-cluster" : (allCompleted ? "pin-quest-completed pin-quest-cluster" : "pin-quest-other pin-quest-cluster");
      if (anySelected) cls += " is-highlighted";

      const lead = items.find((x) => x.status === "active" || x.status === "available") || items[0];
      const pinLabel = `${esc(lead.taskName)} <span class="pin-cluster-cnt">+${items.length - 1}</span>`;

      const tooltipRows = items.map((qm) => {
        const isAct = qm.status === "active" || qm.status === "available";
        const isComp = qm.status === "completed";
        const stCol = isComp ? "#34d399" : (isAct ? "#c084fc" : "#a1a1aa");
        const badgeCol = isComp ? "green" : (isAct ? (qm.status === "active" ? "green" : "blue") : "");
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border);">
            <span style="color:${stCol};font-weight:600;">${esc(qm.taskName)}</span>
            <span class="badge ${badgeCol}" style="font-size:9.5px;flex-shrink:0;">${esc(getTreeStatusLabel(qm.status))}</span>
          </div>
        `;
      }).join("");

      const tooltipHtml = `
        <div class="map-tooltip-header">
          <div class="map-tooltip-title" style="color:var(--accent-bright);">${esc(t("map_cluster_title", { n: items.length }))}</div>
        </div>
        <div class="map-tooltip-body">${tooltipRows}</div>
        <div class="map-tooltip-footer">
          <span style="color:var(--accent-bright);font-weight:600;">${esc(t("map_cluster_foot"))}</span>
        </div>
      `;

      const clusterCards = items.map((qm) => {
        const fullTask = taskLookup.get(qm.taskId) || {
          taskId: qm.taskId,
          taskName: qm.taskName,
          traderName: qm.traderName,
          status: qm.status,
          kappaRequired: qm.kappaRequired,
          lightkeeperRequired: qm.lightkeeperRequired,
          neededKeys: [],
          points: [],
        };
        const isComp = qm.status === "completed";
        const isAct = qm.status === "active" || qm.status === "available";
        const stColor = isComp ? "green" : (isAct ? "blue" : "");
        const itemsTags = (qm.neededItems || []).map((it) => `<span class="badge amber" style="font-size:10px;">${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ""}</span>`).join(" ");
        const keysTags = (fullTask.neededKeys || []).map((k) => `<span class="badge" style="font-size:10px;">🔑 ${esc(k.shortName || k.name)}</span>`).join(" ");
        return `
          <div class="cluster-popover-item">
            <div class="cluster-popover-item-head">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:12.5px;color:var(--text);">${esc(qm.taskName)}</div>
                <div class="muted" style="font-size:11px;">${esc(qm.traderName || "—")}</div>
              </div>
              <span class="badge ${stColor}" style="font-size:10px;flex-shrink:0;">${esc(getTreeStatusLabel(qm.status))}</span>
            </div>
            <div style="font-size:11.5px;line-height:1.38;color:var(--text-muted);">${esc(qm.description || t("map_goal_default"))}</div>
            ${(itemsTags || keysTags) ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">${itemsTags}${keysTags}</div>` : ""}
            <div class="cluster-popover-item-actions">
              <button type="button" class="btn-guide compact" onclick="openQuestGuide('${esc(qm.taskId)}')">${GUIDE_BOOK_ICO}${esc(t("btn_guide"))}</button>
              <button type="button" class="btn btn-ghost" style="padding:3px 7px;font-size:11px;" onclick="setMapTaskStatus('${esc(qm.taskId)}','active')">${esc(t("status_active"))}</button>
              <button type="button" class="btn btn-primary" style="padding:3px 7px;font-size:11px;" onclick="setMapTaskStatus('${esc(qm.taskId)}','completed')">${esc(t("status_completed"))}</button>
            </div>
          </div>
        `;
      }).join("");

      const detailHtml = `
        <div class="map-popover-head">
          <div style="min-width:0;">
            <div class="map-popover-title" style="color:var(--accent-bright);">${esc(t("map_cluster_title", { n: items.length }))}</div>
          </div>
          <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
        </div>
        <div class="cluster-popover-list">${clusterCards}</div>
      `;

      addPin(cl.uv, cls, pinLabel, detailHtml, lead.taskId, tooltipHtml);
    });
  }
  if (showPin && lastPin && lastPin.uv && (!lastPin.mapId || lastPin.mapId === map.id)) {
    const tooltipHtml = `
      <div class="map-tooltip-header">
        <div class="map-tooltip-title" style="color:#ef4444;">${esc(t("map_player_title"))}</div>
      </div>
      <div class="map-tooltip-body" style="font-size:11px;">
        <div>${esc(lastPin.filename)}</div>
        <div>X: ${lastPin.x}, Y: ${lastPin.y}, Z: ${lastPin.z} • ${esc(t("map_player_yaw"))} ${lastPin.yaw}°</div>
      </div>
    `;
    const detailHtml = `
      <div class="map-popover-head">
        <div style="min-width:0;">
          <div class="map-popover-title" style="color:#ef4444;">${esc(t("map_player_title"))}</div>
          <div class="map-popover-meta"><span>${esc(t("map_player_sub"))}</span></div>
        </div>
        <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
      </div>
      <div class="map-popover-body">
        <div>${esc(lastPin.filename)}</div>
        <div class="muted">X: ${lastPin.x}, Y: ${lastPin.y}, Z: ${lastPin.z} • ${esc(t("map_player_yaw"))} ${lastPin.yaw}°</div>
      </div>
    `;
    addPin(lastPin.uv, "pin-player", `➤`, detailHtml, null, tooltipHtml);
  }
  if (showBosses) {
    const seenBossSpots = new Set();
    (map.bosses || []).forEach((b) => {
      if (b.isBoss === false) return;
      (b.spawnLocations || []).forEach((sl) => {
        if (!sl.uv) return;
        const spotKey = `${b.name}|${sl.name}`;
        if (seenBossSpots.has(spotKey)) return;
        seenBossSpots.add(spotKey);

        const lbl = `${b.name} (${b.chance}%)`;
        const zoneTxt = sl.name || (state.lang === "en" ? "Spawn zone" : "Зона спавна");
        const zoneChanceTxt = sl.chance ? t("map_boss_spot_chance", { chance: sl.chance }) : "";
        const tooltipHtml = `
          <div class="map-tooltip-header">
            <div class="map-tooltip-title" style="color:#f87171;">${esc(b.name)}</div>
            <span class="badge red" style="font-size:10px;">${b.chance}%</span>
          </div>
          <div class="map-tooltip-body">
            <div><b>${esc(t("map_boss_spot"))}</b> ${esc(zoneTxt)}</div>
            <div class="muted" style="margin-top:2px;">${esc(t("map_boss_map_chance", { chance: b.chance }))}${esc(zoneChanceTxt)}</div>
          </div>
          <div class="map-tooltip-footer">
            <span>${esc(t("map_boss_spawn_foot"))}</span>
          </div>
        `;
        const detailHtml = `
          <div class="map-popover-head">
            <div style="min-width:0;">
              <div class="map-popover-title" style="color:#f87171;">${esc(b.name)}</div>
              <div class="map-popover-meta">
                <span class="badge red" style="font-size:10px;">${esc(t("map_boss_chance_badge", { chance: b.chance }))}</span>
                <span>${esc(t("map_boss_spawn_foot"))}</span>
              </div>
            </div>
            <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
          </div>
          <div class="map-popover-body">
            <div><b>${esc(t("map_boss_spot"))}</b> ${esc(zoneTxt)}</div>
            <div class="muted">${esc(t("map_boss_map_chance", { chance: b.chance }))}${esc(zoneChanceTxt)}</div>
          </div>
        `;
        addPin(
          sl.uv,
          "pin-boss",
          lbl,
          detailHtml,
          null,
          tooltipHtml
        );
      });
    });
  }

  const svgHost = document.getElementById("mapSvgHost");
  const satCanvas = document.getElementById("mapSatCanvas");
  const rawH = Math.max(svgHost?.offsetHeight || 0, satCanvas?.offsetHeight || 0);
  const mapW = 1000;
  const mapH = rawH > 100 ? rawH : 620;
  layoutCalloutPins(pins, mapW, mapH);

  const curFloor = state.activeMapFloor || "all";
  const leaderLines = [];
  const pinHtml = [];

  pins.forEach((p, idx) => {
    const dim = curFloor !== "all" && p.floorId && p.floorId !== curFloor ? " is-dimmed-floor" : "";
    const sel = state.selectedLockPinId && p.lockId && p.lockId === state.selectedLockPinId ? " pin-selected" : "";
    const floorAttr = esc(p.floorId || "");

    if (!p._callout) {
      pinHtml.push(`<div class="map-pin ${p.cls}${dim}${sel}" style="left:${p.left}%;top:${p.top}%;" data-pin-idx="${idx}" data-floor-id="${floorAttr}">${p.label}</div>`);
      return;
    }

    const c = p._callout;
    const isLockCls = (p.cls || "").includes("pin-lock") ? " pin-lock" : "";
    const sideCls = c.isRight ? "callout-right" : "callout-left";
    const groupCls = c.groupSize > 1 ? " has-group" : "";
    const delayMs = Math.min(112, c.staggerIdx * 28);
    leaderLines.push(`<polyline class="map-leader-hit" data-pin-idx="${idx}" data-reveal-group="${c.groupId}" points="${c.pointsStr}" />`);
    leaderLines.push(`<polyline class="map-leader${isLockCls}${dim}" data-pin-idx="${idx}" data-reveal-group="${c.groupId}" data-floor-id="${floorAttr}" points="${c.pointsStr}" stroke="${c.accent}" style="--leader-len:${c.leaderLen};--reveal-delay:${delayMs}ms;" />`);
    pinHtml.push(`<div class="map-pin-anchor${isLockCls}${dim}${groupCls}" style="left:${p.left}%;top:${p.top}%;background:${c.accent};" data-pin-idx="${idx}" data-reveal-group="${c.groupId}" data-floor-id="${floorAttr}"></div>`);
    pinHtml.push(`<div class="map-pin map-pin-callout ${sideCls} ${p.cls}${dim}${sel}" style="left:${c.boxLeftPct.toFixed(3)}%;top:${c.boxTopPct.toFixed(3)}%;--reveal-delay:${delayMs}ms;" data-pin-idx="${idx}" data-reveal-group="${c.groupId}" data-floor-id="${floorAttr}">${p.label}</div>`);
  });

  pinsHost.innerHTML = `<svg class="map-leaders-svg" viewBox="0 0 ${mapW} ${mapH}" preserveAspectRatio="none">${leaderLines.join("")}</svg>${pinHtml.join("")}`;
  pinsHost._pins = pins;
}

const activeMapPopover = { uv: null, pinEl: null };

function repositionMapPopover() {
  if (!activeMapPopover.uv) return;
  const pop = document.getElementById("mapPinPopover");
  const vp = document.getElementById("mapViewport");
  const cv = document.getElementById("mapCanvas");
  if (!pop || pop.dataset.open !== "true" || !vp || !cv) return;

  const cw = cv.offsetWidth || 1000;
  const ch = cv.offsetHeight || 620;
  const u = Math.max(0.01, Math.min(0.99, activeMapPopover.uv[0]));
  const v = Math.max(0.01, Math.min(0.99, activeMapPopover.uv[1]));
  const anchorX = state.mapPanX + u * cw * state.mapZoom;
  const anchorY = state.mapPanY + v * ch * state.mapZoom;

  let pinLeft = anchorX - 18;
  let pinRight = anchorX + 18;
  let pinTop = anchorY - 12;
  if (activeMapPopover.pinEl && activeMapPopover.pinEl.isConnected) {
    const vpRect = vp.getBoundingClientRect();
    const pr = activeMapPopover.pinEl.getBoundingClientRect();
    if (pr.width > 0 && pr.height > 0) {
      pinLeft = pr.left - vpRect.left;
      pinRight = pr.right - vpRect.left;
      pinTop = pr.top - vpRect.top;
    }
  }

  const vw = vp.clientWidth || 800;
  const vh = vp.clientHeight || 600;
  const popW = pop.offsetWidth || 324;
  const popH = pop.offsetHeight || 190;
  const gap = 12;

  let left = pinRight + gap;
  if (left + popW > vw - 12) {
    left = pinLeft - popW - gap;
  }
  left = Math.max(12, Math.min(vw - popW - 12, left));

  let top = pinTop - 8;
  top = Math.max(12, Math.min(vh - popH - 12, top));

  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

window.openMapPinPopover = function openMapPinPopover(uv, html, pinEl = null) {
  const pop = document.getElementById("mapPinPopover");
  if (!pop) return;
  activeMapPopover.uv = uv || [0.5, 0.5];
  activeMapPopover.pinEl = pinEl || null;
  const pinsHost = document.getElementById("mapPinsHost");
  if (pinsHost) {
    pinsHost.querySelectorAll(".is-pinned").forEach((n) => n.classList.remove("is-pinned"));
    if (pinEl?.dataset?.pinIdx !== undefined) {
      pinsHost.querySelectorAll(`[data-pin-idx="${pinEl.dataset.pinIdx}"]`).forEach((n) => n.classList.add("is-pinned"));
    }
  }
  hideMapTooltip();
  pop.innerHTML = html;
  pop.dataset.open = "true";
  pop.setAttribute("aria-hidden", "false");
  repositionMapPopover();
  requestAnimationFrame(repositionMapPopover);
};

window.closeMapPinPopover = function closeMapPinPopover() {
  const pop = document.getElementById("mapPinPopover");
  activeMapPopover.uv = null;
  activeMapPopover.pinEl = null;
  if (pop) {
    pop.dataset.open = "false";
    pop.setAttribute("aria-hidden", "true");
  }
  document.querySelectorAll("#mapPinsHost .map-pin.pin-selected").forEach((n) => n.classList.remove("pin-selected"));
  document.querySelectorAll("#mapPinsHost .is-pinned").forEach((n) => n.classList.remove("is-pinned"));
  state.selectedLockPinId = null;
};

window.addEventListener("resize", repositionMapPopover);

document.getElementById("mapPinsHost").addEventListener("click", (e) => {
  const el = e.target.closest(".map-pin, .map-pin-anchor, .map-leader-hit");
  if (!el) return;
  e.stopPropagation();
  const pinIdx = Number(el.dataset.pinIdx);
  const pinsHost = document.getElementById("mapPinsHost");
  const pins = pinsHost._pins || [];
  const p = pins[pinIdx];
  if (!p) return;
  const labelEl = pinsHost.querySelector(`.map-pin[data-pin-idx="${pinIdx}"]`) || el;
  document.querySelectorAll("#mapPinsHost .map-pin.pin-selected").forEach((n) => n.classList.remove("pin-selected"));
  labelEl.classList.add("pin-selected");
  state.selectedLockPinId = p.lockId || null;

  openMapPinPopover(p.uv, p.detailHtml, labelEl);
  if (p.floorId) {
    setActiveMapFloor(p.floorId);
  }
  if (p.taskId) {
    const card = document.querySelector(`#mapActiveTasksList .map-task-card[data-task-id="${p.taskId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
});

// --- HOVER TOOLTIP ON MAP ---
const mapViewportEl = document.getElementById("mapViewport");
const mapTooltipEl = document.getElementById("mapTooltip");
let hoveredMapPinIdx = null;
let tooltipWarmUntil = 0;
let revealedGroupId = null;
let revealCloseTimer = null;

function cancelHideRevealedGroup() {
  if (revealCloseTimer !== null) {
    clearTimeout(revealCloseTimer);
    revealCloseTimer = null;
  }
}

function setRevealedGroup(groupId) {
  cancelHideRevealedGroup();
  if (groupId === revealedGroupId) return;
  const pinsHost = document.getElementById("mapPinsHost");
  if (pinsHost) {
    pinsHost.querySelectorAll(".is-revealed").forEach((node) => node.classList.remove("is-revealed"));
    if (groupId) {
      pinsHost.querySelectorAll(`[data-reveal-group="${groupId}"]`).forEach((node) => node.classList.add("is-revealed"));
    }
  }
  revealedGroupId = groupId || null;
}

function scheduleHideRevealedGroup() {
  if (revealCloseTimer !== null) return;
  revealCloseTimer = setTimeout(() => {
    revealCloseTimer = null;
    setRevealedGroup(null);
    setHoveredCallout(null);
  }, 260);
}

function setHoveredCallout(idx) {
  const pinsHost = document.getElementById("mapPinsHost");
  if (!pinsHost) return;
  pinsHost.querySelectorAll(".is-hovered").forEach((node) => node.classList.remove("is-hovered"));
  if (idx === null || idx === undefined || typeof idx !== "number") return;
  pinsHost.querySelectorAll(`[data-pin-idx="${idx}"]`).forEach((node) => node.classList.add("is-hovered"));
}

function showMapTooltip(html, e) {
  if (!mapTooltipEl) return;
  const wasOpen = mapTooltipEl.dataset.open === "true";
  const isWarm = wasOpen || Date.now() < tooltipWarmUntil;
  mapTooltipEl.dataset.instant = isWarm ? "true" : "false";
  mapTooltipEl.innerHTML = html;
  mapTooltipEl.dataset.open = "true";
  mapTooltipEl.setAttribute("aria-hidden", "false");
  positionMapTooltip(e);
}

if (mapViewportEl && mapTooltipEl) {
  mapViewportEl.addEventListener("mousemove", (e) => {
    if (dragging || e.target.closest(".map-popover")) {
      hideMapTooltip();
      scheduleHideRevealedGroup();
      return;
    }
    const hitEl = e.target.closest(".map-pin, .map-pin-anchor, .map-leader-hit");
    if (hitEl) {
      cancelHideRevealedGroup();
      const idx = Number(hitEl.dataset.pinIdx);
      const groupId = hitEl.dataset.revealGroup || null;
      if (groupId) setRevealedGroup(groupId);

      const pinsHost = document.getElementById("mapPinsHost");
      const labelEl = pinsHost?.querySelector(`.map-pin[data-pin-idx="${idx}"]`) || hitEl;
      const pins = pinsHost?._pins || [];
      const p = pins[idx];

      setHoveredCallout(idx);

      if (activeMapPopover.pinEl && (hitEl === activeMapPopover.pinEl || labelEl === activeMapPopover.pinEl)) {
        hideMapTooltip(true);
        return;
      }

      const isLabel = hitEl.classList.contains("map-pin");
      const isDirectPin = isLabel && !hitEl.classList.contains("map-pin-callout");
      const isRevealedLabel = isLabel && hitEl.classList.contains("map-pin-callout");

      if (p && p.tooltipHtml && (isDirectPin || isRevealedLabel)) {
        if (hoveredMapPinIdx !== idx) {
          hoveredMapPinIdx = idx;
          showMapTooltip(p.tooltipHtml, e);
        } else {
          positionMapTooltip(e);
        }
        return;
      }

      // Hovering anchor dot or leader corridor: keep callout revealed, hide stale floating tooltip
      hideMapTooltip(true);
      return;
    }

    scheduleHideRevealedGroup();

    // Check SVG map elements with titles or meaningful labels
    const svgTarget = e.target.closest("g[id], text, path[title]");
    if (svgTarget) {
      const rawTitle = svgTarget.getAttribute("title") || svgTarget.id || "";
      if (rawTitle && !rawTitle.startsWith("path") && !rawTitle.startsWith("svg_") && rawTitle.length > 2 && isNaN(Number(rawTitle))) {
        const cleanTitle = rawTitle.replace(/[-_]/g, " ");
        if (hoveredMapPinIdx !== "svg-" + rawTitle) {
          hoveredMapPinIdx = "svg-" + rawTitle;
          setHoveredCallout(null);
          showMapTooltip(`
            <div class="map-tooltip-header">
              <div class="map-tooltip-title">${esc(cleanTitle)}</div>
            </div>
            <div class="map-tooltip-body" style="font-size:11px;color:var(--text-muted);">${esc(t("map_svg_zone"))}</div>
          `, e);
        } else {
          positionMapTooltip(e);
        }
        return;
      }
    }

    hideMapTooltip();
  });

  mapViewportEl.addEventListener("mouseleave", () => {
    hideMapTooltip();
    scheduleHideRevealedGroup();
  });
}

function hideMapTooltip(keepCalloutHover = false) {
  if (hoveredMapPinIdx !== null) {
    hoveredMapPinIdx = null;
    if (!keepCalloutHover) setHoveredCallout(null);
    if (mapTooltipEl && mapTooltipEl.dataset.open === "true") {
      tooltipWarmUntil = Date.now() + 300;
      mapTooltipEl.dataset.instant = "false";
      mapTooltipEl.dataset.open = "false";
      mapTooltipEl.setAttribute("aria-hidden", "true");
    }
  }
}

function positionMapTooltip(e) {
  if (!mapViewportEl || !mapTooltipEl) return;
  const vRect = mapViewportEl.getBoundingClientRect();
  const tipW = mapTooltipEl.offsetWidth || 260;
  const tipH = mapTooltipEl.offsetHeight || 120;
  let tx = e.clientX - vRect.left + 14;
  let ty = e.clientY - vRect.top + 14;

  if (tx + tipW > vRect.width - 12) {
    tx = e.clientX - vRect.left - tipW - 14;
  }
  if (ty + tipH > vRect.height - 12) {
    ty = e.clientY - vRect.top - tipH - 14;
  }
  if (tx < 10) tx = 10;
  if (ty < 10) ty = 10;

  mapTooltipEl.style.left = `${tx}px`;
  mapTooltipEl.style.top = `${ty}px`;
}

const viewport = document.getElementById("mapViewport");
const canvas = document.getElementById("mapCanvas");
let mapTransformRaf = null;
let mapWheelTimer = null;

function applyMapTransform() {
  if (mapTransformRaf) return;
  mapTransformRaf = requestAnimationFrame(() => {
    mapTransformRaf = null;
    canvas.style.transform = `translate3d(${state.mapPanX}px, ${state.mapPanY}px, 0) scale(${state.mapZoom})`;
    repositionMapPopover();
  });
}
function resetMapTransform() {
  state.mapZoom = 0.88;
  state.mapPanX = 20;
  state.mapPanY = 20;
  applyMapTransform();
}
viewport.addEventListener("wheel", (e) => {
  if (e.target.closest(".map-popover")) return;
  e.preventDefault();
  state.isGesturing = true;
  clearTimeout(mapWheelTimer);
  mapWheelTimer = setTimeout(() => { state.isGesturing = false; }, 120);
  const rect = viewport.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  const nextZoom = Math.max(0.35, Math.min(4.5, state.mapZoom * factor));
  const scaleChange = nextZoom / state.mapZoom;
  state.mapPanX = mx - (mx - state.mapPanX) * scaleChange;
  state.mapPanY = my - (my - state.mapPanY) * scaleChange;
  state.mapZoom = nextZoom;
  applyMapTransform();
}, { passive: false });
let dragging = false, dragX = 0, dragY = 0, dragStartX = 0, dragStartY = 0, dragMoved = false;
viewport.addEventListener("mousedown", (e) => {
  if (e.target.closest(".map-pin, .map-popover")) return;
  dragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  state.isGesturing = true;
  dragX = e.clientX - state.mapPanX;
  dragY = e.clientY - state.mapPanY;
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  if (!dragMoved && (Math.abs(e.clientX - dragStartX) > 3 || Math.abs(e.clientY - dragStartY) > 3)) {
    dragMoved = true;
  }
  state.mapPanX = e.clientX - dragX;
  state.mapPanY = e.clientY - dragY;
  applyMapTransform();
});
window.addEventListener("mouseup", (e) => {
  if (dragging) {
    dragging = false;
    state.isGesturing = false;
    if (!dragMoved && !e.target?.closest?.(".map-pin, .map-popover")) {
      closeMapPinPopover();
    }
  }
});
document.getElementById("btnMapZoomIn").addEventListener("click", () => { state.mapZoom = Math.min(4.5, state.mapZoom * 1.2); applyMapTransform(); });
document.getElementById("btnMapZoomOut").addEventListener("click", () => { state.mapZoom = Math.max(0.35, state.mapZoom / 1.2); applyMapTransform(); });
document.getElementById("btnMapReset").addEventListener("click", resetMapTransform);

  return {
    loadMapView,
    renderMapPins,
    applyMapTaskFilter,
    repositionMapPopover,
    resetMapTransform,
    clearMapTaskSelection,
  };
}
