const state = {
  mode: "regular",
  lang: localStorage.getItem("eft_assistant_lang") === "en" ? "en" : "ru",
  activeTab: "quests",
  bootstrap: null,
  quests: null,
  questsMode: null,
  questsLang: null,
  dataRev: 1,
  isGesturing: false,
  needTab: "fir",
  currentMapNorm: "customs",
  currentMapData: null,
  mapZoom: 1,
  mapPanX: 0,
  mapPanY: 0,
  cultistBasket: [],
  cultistTimers: [],
  selectedCounterItem: null,
  counterItems: [],
  counterKpis: null,
  counterStatusFilter: "all",
  counterCategoryFilter: "all",
  counterSearchQuery: "",
  selectedTreeTaskId: null,
  focusedMapTaskId: null,
  selectedMapTaskIds: new Set(),
  mapTaskSearchQuery: "",
  mapTaskStatusFilter: "active",
  cultistPlans: [],
};
window.state = state;

const renderCache = {
  questsSig: null,
  treeSig: null,
  mapsSig: null,
  mapsDataByKey: new Map(),
  cultistSig: null,
  itemsSig: null,
};

function invalidateDataCache(clearMaps = false) {
  state.dataRev += 1;
  state.quests = null;
  state.questsMode = null;
  state.questsLang = null;
  renderCache.questsSig = null;
  renderCache.treeSig = null;
  renderCache.mapsSig = null;
  renderCache.cultistSig = null;
  renderCache.itemsSig = null;
  if (clearMaps) renderCache.mapsDataByKey.clear();
}

const numLocale = () => (state.lang === "en" ? "en-US" : "ru-RU");
const fmtNum = (n) => Math.round(Number(n || 0)).toLocaleString(numLocale());
const fmtRub = (n) => `${fmtNum(n)} ₽`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mediaSrc = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("https://minio.tarkov.help/")) {
    return `/api/media-proxy?url=${encodeURIComponent(s)}`;
  }
  return s;
};
const GUIDE_BOOK_ICO = `<svg class="guide-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(url, opts = {}) {
  let targetUrl = url;
  if (targetUrl.startsWith("/api/") && !/[?&]lang=/.test(targetUrl)) {
    const sep = targetUrl.includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}lang=${encodeURIComponent(state.lang)}`;
  }
  const res = await fetch(targetUrl, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- THEME & STYLE ENGINE (Base/Accent Colors + UI Architecture + Shader Mode + Glow + WCAG Contrast Guard) ---
const ThemeManager = (() => {
  const STORAGE_KEY = "eft_assistant_theme_v1";
  const DEFAULT_THEME = {
    base: "#0c0d0f",
    accent: "#d99b26",
    uiStyle: "tactical",
    shaderMode: "topo",
    glowMode: "standard",
  };
  const UI_STYLES = [
    { id: "tactical", name: { ru: "Тактический", en: "Tactical" }, desc: { ru: "Чёткие грани 5px", en: "Sharp 5px edges" } },
    { id: "glass", name: { ru: "Стеклянный HUD", en: "Glass HUD" }, desc: { ru: "Полупрозрачный blur", en: "Translucent blur" } },
    { id: "brutalist", name: { ru: "Брутализм", en: "Brutalist" }, desc: { ru: "Углы 0px и тени", en: "0px corners & shadows" } },
    { id: "soft", name: { ru: "Мягкий", en: "Soft" }, desc: { ru: "Округлый 10–14px", en: "Rounded 10–14px" } },
    { id: "cyber", name: { ru: "Кибер-дек", en: "Cyberdeck" }, desc: { ru: "Моно и акцент-рамки", en: "Mono & accent frames" } },
  ];
  const SHADER_MODES = [
    { id: "topo", name: { ru: "Топография", en: "Topography" }, desc: { ru: "Изогипсы и пульс", en: "Contours & pulse" } },
    { id: "matrix", name: { ru: "Поток данных", en: "Data Stream" }, desc: { ru: "Волна символов", en: "Glyph wave" } },
    { id: "radar", name: { ru: "Радар-сетка", en: "Radar Grid" }, desc: { ru: "Скан-фронт слева", en: "Left-to-right scan" } },
    { id: "minimal", name: { ru: "Минимализм", en: "Minimal" }, desc: { ru: "Спокойные точки", en: "Subtle dots" } },
    { id: "off", name: { ru: "Отключён", en: "Disabled" }, desc: { ru: "Чистый статичный фон", en: "Clean static canvas" } },
  ];
  const GLOW_MODES = [
    { id: "standard", name: { ru: "Стандарт", en: "Standard" }, desc: { ru: "Умеренный контраст", en: "Balanced contrast" } },
    { id: "neon", name: { ru: "Неоновый контур", en: "Neon Rim" }, desc: { ru: "Акцентное свечение", en: "Accent glow" } },
    { id: "minimal", name: { ru: "Строгий матовый", en: "Matte" }, desc: { ru: "Без теней и бликов", en: "No shadows or glow" } },
  ];
  const PRESETS = [
    { id: "terminal", name: "Terminal Amber", base: "#0c0d0f", accent: "#d99b26" },
    { id: "usec", name: "USEC Olive", base: "#0c110d", accent: "#84cc16" },
    { id: "terra", name: "TERRA Cyan", base: "#090e14", accent: "#38bdf8" },
    { id: "crimson", name: "Crimson Raid", base: "#120b0d", accent: "#ef4444" },
    { id: "cultist", name: "Cultist Violet", base: "#0f0c14", accent: "#a855f7" },
    { id: "nvg", name: "Night Vision", base: "#07100c", accent: "#22c55e" },
    { id: "kiba", name: "Kiba Titanium", base: "#111317", accent: "#e2e8f0" },
    { id: "streets", name: "Streets Neon", base: "#0d0b14", accent: "#f472b6" },
    { id: "azure", name: "Shoreline Azure", base: "#091018", accent: "#2dd4bf" },
    { id: "amoled", name: "AMOLED Stealth", base: "#040506", accent: "#f59e0b" },
    { id: "labs", name: "Labs Sterile", base: "#eef2f6", accent: "#0284c7" },
    { id: "paper", name: "Tactical Light", base: "#efede7", accent: "#c27803" },
  ];

  let current = { ...DEFAULT_THEME };

  function normalizeHex(raw, fallback) {
    const m = String(raw || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
    return m ? `#${m[1].toLowerCase()}` : fallback;
  }

  function hexToRgb(hex) {
    const clean = normalizeHex(hex, "#000000").slice(1);
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  function rgbToHex({ r, g, b }) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
  }

  function mixRgb(a, b, t) {
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t,
    };
  }

  function relLuminance({ r, g, b }) {
    const lin = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrastRatio(rgbA, rgbB) {
    const la = relLuminance(rgbA);
    const lb = relLuminance(rgbB);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  function rgbaStr(rgb, a) {
    return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
  }

  function normalizeOpt(val, list, fallback) {
    return list.some((x) => x.id === val) ? val : fallback;
  }

  function applyTheme(theme, persist = true) {
    const baseHex = normalizeHex(theme?.base, current.base || DEFAULT_THEME.base);
    const accentHex = normalizeHex(theme?.accent, current.accent || DEFAULT_THEME.accent);
    const uiStyle = normalizeOpt(theme?.uiStyle, UI_STYLES, current.uiStyle || DEFAULT_THEME.uiStyle);
    const shaderMode = normalizeOpt(theme?.shaderMode, SHADER_MODES, current.shaderMode || DEFAULT_THEME.shaderMode);
    const glowMode = normalizeOpt(theme?.glowMode, GLOW_MODES, current.glowMode || DEFAULT_THEME.glowMode);
    current = { base: baseHex, accent: accentHex, uiStyle, shaderMode, glowMode };

    const baseRgb = hexToRgb(baseHex);
    const accentRgb = hexToRgb(accentHex);
    const isLight = relLuminance(baseRgb) >= 0.32;

    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };

    const insetRgb = isLight ? mixRgb(baseRgb, black, 0.07) : mixRgb(baseRgb, black, 0.34);
    const surfaceRgb = isLight ? mixRgb(baseRgb, white, 0.56) : mixRgb(baseRgb, white, 0.036);
    const surface2Rgb = isLight ? mixRgb(baseRgb, black, 0.035) : mixRgb(baseRgb, white, 0.075);

    const textRgb = isLight ? { r: 20, g: 22, b: 26 } : { r: 230, g: 231, b: 235 };
    const mutedRgb = isLight ? { r: 74, g: 82, b: 96 } : { r: 147, g: 152, b: 163 };
    const subtleRgb = isLight ? { r: 112, g: 120, b: 133 } : { r: 102, g: 108, b: 119 };

    const accentBrightRgb = isLight ? mixRgb(accentRgb, black, 0.16) : mixRgb(accentRgb, white, 0.2);
    const darkInk = { r: 11, g: 12, b: 14 };
    const lightInk = { r: 255, g: 255, b: 255 };
    const onAccentRgb = contrastRatio(accentRgb, darkInk) >= contrastRatio(accentRgb, lightInk) ? darkInk : lightInk;

    const root = document.documentElement;
    root.style.colorScheme = isLight ? "light" : "dark";
    root.dataset.uiStyle = uiStyle;
    root.dataset.glowMode = glowMode;

    const vars = {
      "--bg": baseHex,
      "--bg-inset": rgbToHex(insetRgb),
      "--surface": rgbToHex(surfaceRgb),
      "--surface-2": rgbToHex(surface2Rgb),
      "--text": rgbToHex(textRgb),
      "--text-muted": rgbToHex(mutedRgb),
      "--text-subtle": rgbToHex(subtleRgb),
      "--border": isLight ? "rgba(0, 0, 0, 0.10)" : "rgba(255, 255, 255, 0.07)",
      "--border-strong": isLight ? "rgba(0, 0, 0, 0.20)" : "rgba(255, 255, 255, 0.14)",
      "--hover-tint": isLight ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.03)",
      "--border-hover": isLight ? "rgba(0, 0, 0, 0.34)" : "rgba(255, 255, 255, 0.28)",
      "--bg-a72": rgbaStr(baseRgb, 0.72),
      "--bg-a78": rgbaStr(baseRgb, 0.78),
      "--bg-a82": rgbaStr(baseRgb, 0.82),
      "--bg-a86": rgbaStr(baseRgb, 0.86),
      "--inset-a45": rgbaStr(insetRgb, 0.45),
      "--inset-a68": rgbaStr(insetRgb, 0.68),
      "--inset-a72": rgbaStr(insetRgb, 0.72),
      "--inset-a86": rgbaStr(insetRgb, 0.86),
      "--surface-a96": rgbaStr(surface2Rgb, 0.96),
      "--map-veil": rgbaStr(insetRgb, 0.24),
      "--accent": accentHex,
      "--accent-bright": rgbToHex(accentBrightRgb),
      "--accent-dim": rgbaStr(accentRgb, isLight ? 0.14 : 0.15),
      "--accent-border": rgbaStr(accentRgb, 0.36),
      "--accent-glow": rgbaStr(accentRgb, 0.22),
      "--on-accent": rgbToHex(onAccentRgb),
    };
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (_) {}
    }

    const triggerHex = document.getElementById("themeTriggerHex");
    if (triggerHex) triggerHex.textContent = accentHex;
    syncModalControls(textRgb, baseRgb, accentRgb, onAccentRgb);
    window.dispatchEvent(new CustomEvent("eft-theme-change", { detail: { ...current, isLight } }));
  }

  function syncModalControls(textRgb, baseRgb, accentRgb, onAccentRgb) {
    const bp = document.getElementById("themeBasePicker");
    const bh = document.getElementById("themeBaseHex");
    const ap = document.getElementById("themeAccentPicker");
    const ah = document.getElementById("themeAccentHex");
    if (bp && bp.value !== current.base) bp.value = current.base;
    if (bh && document.activeElement !== bh) bh.value = current.base;
    if (ap && ap.value !== current.accent) ap.value = current.accent;
    if (ah && document.activeElement !== ah) ah.value = current.accent;

    document.querySelectorAll("#themeStyleGrid .style-opt-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.uiStyle === current.uiStyle);
    });
    document.querySelectorAll("#themeShaderGrid .style-opt-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.shaderMode === current.shaderMode);
    });
    document.querySelectorAll("#themeGlowGrid .style-opt-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.glowMode === current.glowMode);
    });
    document.querySelectorAll("#themePresetsGrid .theme-preset-btn").forEach((btn) => {
      const active = btn.dataset.base === current.base && btn.dataset.accent === current.accent;
      btn.classList.toggle("active", active);
    });

    const tVal = document.getElementById("themeContrastTextVal");
    const aVal = document.getElementById("themeContrastAccentVal");
    if (tVal) tVal.textContent = `${contrastRatio(textRgb, baseRgb).toFixed(1)}:1`;
    if (aVal) aVal.textContent = `${contrastRatio(onAccentRgb, accentRgb).toFixed(1)}:1`;
  }

  function renderOptButtons(hostId, items, dataKey, propName) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const lang = state.lang === "en" ? "en" : "ru";
    host.innerHTML = items.map((it) => `
      <button type="button" class="style-opt-btn" data-${dataKey}="${it.id}">
        <span class="style-opt-title">${esc(typeof it.name === "object" ? (it.name[lang] || it.name.ru) : it.name)}</span>
        <span class="style-opt-sub">${esc(typeof it.desc === "object" ? (it.desc[lang] || it.desc.ru) : it.desc)}</span>
      </button>
    `).join("");
    if (!host.dataset.boundClick) {
      host.dataset.boundClick = "1";
      host.addEventListener("click", (e) => {
        const btn = e.target.closest(".style-opt-btn");
        if (!btn) return;
        applyTheme({ ...current, [propName]: btn.dataset[propName] });
      });
    }
  }

  function refreshLabels() {
    renderOptButtons("themeStyleGrid", UI_STYLES, "ui-style", "uiStyle");
    renderOptButtons("themeShaderGrid", SHADER_MODES, "shader-mode", "shaderMode");
    renderOptButtons("themeGlowGrid", GLOW_MODES, "glow-mode", "glowMode");
    applyTheme(current, false);
  }

  function bindUi() {
    const themeModal = document.getElementById("themeModal");
    renderOptButtons("themeStyleGrid", UI_STYLES, "ui-style", "uiStyle");
    renderOptButtons("themeShaderGrid", SHADER_MODES, "shader-mode", "shaderMode");
    renderOptButtons("themeGlowGrid", GLOW_MODES, "glow-mode", "glowMode");

    const presetsHost = document.getElementById("themePresetsGrid");
    if (presetsHost) {
      presetsHost.innerHTML = PRESETS.map((p) => `
        <button type="button" class="theme-preset-btn" data-base="${p.base}" data-accent="${p.accent}">
          <span class="theme-pair-dots" aria-hidden="true">
            <span class="dot-base" style="background:${p.base};"></span>
            <span class="dot-accent" style="background:${p.accent};"></span>
          </span>
          <span>${esc(p.name)}</span>
        </button>
      `).join("");
      presetsHost.addEventListener("click", (e) => {
        const btn = e.target.closest(".theme-preset-btn");
        if (!btn) return;
        applyTheme({ ...current, base: btn.dataset.base, accent: btn.dataset.accent });
      });
    }

    document.getElementById("btnThemeModal")?.addEventListener("click", () => {
      applyTheme(current, false);
      openAnimatedModal(themeModal, "#btnDoneTheme");
    });
    ["btnCloseThemeModal", "btnDoneTheme"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => closeAnimatedModal(themeModal));
    });
    themeModal?.addEventListener("click", (e) => {
      if (e.target === themeModal) closeAnimatedModal(themeModal);
    });

    const basePicker = document.getElementById("themeBasePicker");
    const baseHexInp = document.getElementById("themeBaseHex");
    const accentPicker = document.getElementById("themeAccentPicker");
    const accentHexInp = document.getElementById("themeAccentHex");

    basePicker?.addEventListener("input", () => applyTheme({ ...current, base: basePicker.value }));
    accentPicker?.addEventListener("input", () => applyTheme({ ...current, accent: accentPicker.value }));

    baseHexInp?.addEventListener("input", () => {
      if (/^#?[0-9a-fA-F]{6}$/.test(baseHexInp.value.trim())) {
        applyTheme({ ...current, base: baseHexInp.value });
      }
    });
    accentHexInp?.addEventListener("input", () => {
      if (/^#?[0-9a-fA-F]{6}$/.test(accentHexInp.value.trim())) {
        applyTheme({ ...current, accent: accentHexInp.value });
      }
    });

    document.getElementById("btnResetTheme")?.addEventListener("click", () => {
      applyTheme(DEFAULT_THEME);
      showToast(state.lang === "en" ? "Styles & colors reset" : "Стили и цвета сброшены");
    });
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        applyTheme({
          base: parsed.base,
          accent: parsed.accent,
          uiStyle: parsed.uiStyle,
          shaderMode: parsed.shaderMode,
          glowMode: parsed.glowMode,
        }, false);
        return;
      }
    } catch (_) {}
    applyTheme(DEFAULT_THEME, false);
  }

  function getAccentRgb() { return hexToRgb(current.accent); }
  function getAccentBrightRgb() {
    const base = hexToRgb(current.base);
    const acc = hexToRgb(current.accent);
    const isLight = relLuminance(base) >= 0.32;
    return isLight ? mixRgb(acc, { r: 0, g: 0, b: 0 }, 0.16) : mixRgb(acc, { r: 255, g: 255, b: 255 }, 0.2);
  }
  function isLight() { return relLuminance(hexToRgb(current.base)) >= 0.32; }
  function getShaderMode() { return current.shaderMode || "topo"; }

  return { loadSaved, bindUi, refreshLabels, applyTheme, getAccentRgb, getAccentBrightRgb, isLight, getShaderMode };
})();

// --- SHADER-DRIVEN CHARACTER LOADING PLACEHOLDERS ---
const GlyphLoader = (() => {
  const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const SKEL_GLYPHS = " .·:-=+*#%░▒▓▁▂▃▄▅▆▇█┼";
  const BAR_START = 13; // index of ▁ in SKEL_GLYPHS
  const REDUCED_MQ = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  const CW = 9;
  const CH = 13;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cwPx = CW * dpr;
  let chPx = CH * dpr;
  let skelAtlas = null;
  let rafId = null;
  let lastDraw = 0;
  let spinTick = 0;
  let startTime = performance.now();

  function buildAtlas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cwPx = Math.round(CW * dpr);
    chPx = Math.round(CH * dpr);
    skelAtlas = document.createElement("canvas");
    skelAtlas.width = SKEL_GLYPHS.length * cwPx;
    skelAtlas.height = 4 * chPx;
    const actx = skelAtlas.getContext("2d");
    actx.font = `500 ${Math.round(10 * dpr)}px "JetBrains Mono", Consolas, monospace`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";

    const acc = ThemeManager.getAccentRgb();
    const accHi = ThemeManager.getAccentBrightRgb();
    const light = ThemeManager.isLight();
    const slateLo = light ? "75, 82, 96" : "110, 118, 134";
    const slateHi = light ? "40, 46, 58" : "148, 156, 172";
    const tiers = [
      `rgba(${slateLo}, 0.24)`,
      `rgba(${slateHi}, 0.44)`,
      `rgba(${Math.round(acc.r)}, ${Math.round(acc.g)}, ${Math.round(acc.b)}, 0.58)`,
      `rgba(${Math.round(accHi.r)}, ${Math.round(accHi.g)}, ${Math.round(accHi.b)}, 0.92)`,
    ];
    for (let t = 0; t < tiers.length; t++) {
      actx.fillStyle = tiers[t];
      const cy = t * chPx + chPx * 0.52;
      for (let g = 1; g < SKEL_GLYPHS.length; g++) {
        actx.fillText(SKEL_GLYPHS[g], g * cwPx + cwPx * 0.5, cy);
      }
    }
  }

  function syncCanvasSize(canvas) {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!skelAtlas || nextDpr !== dpr) buildAtlas();
    const wCss = Math.max(24, Math.round(canvas.clientWidth || Number(canvas.dataset.w) || 160));
    const hCss = Math.max(14, Math.round(canvas.clientHeight || Number(canvas.dataset.h) || 20));
    const wPx = Math.round(wCss * dpr);
    const hPx = Math.round(hCss * dpr);
    if (canvas.width !== wPx || canvas.height !== hPx) {
      canvas.width = wPx;
      canvas.height = hPx;
    }
    return { wCss, hCss };
  }

  function drawBarShader(canvas, t, mode) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const { wCss, hCss } = syncCanvasSize(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const rect = canvas.getBoundingClientRect();
    const cols = Math.max(2, Math.floor(wCss / CW));
    const rows = Math.max(1, Math.floor(hCss / CH));
    const yOff = Math.round(((hCss - rows * CH) * 0.5) * dpr);
    const xOff = Math.round(((wCss - cols * CW) * 0.5) * dpr);

    for (let r = 0; r < rows; r++) {
      const gy = rect.top + r * CH;
      for (let c = 0; c < cols; c++) {
        const gx = rect.left + c * CW;
        // Synchronized global diagonal character wave across adjacent table/KPI elements
        const phase = gx * 0.011 + gy * 0.014 - t * 2.9;
        const primary = 0.5 + 0.5 * Math.sin(phase);
        const harmonic = 0.5 + 0.5 * Math.cos(phase * 1.9 + c * 0.35);
        const crest = Math.pow(primary, 3.2) * 0.72 + harmonic * 0.28;
        const intensity = mode === "kpi" ? Math.min(1, crest * 1.15) : crest;

        let gIdx;
        if (intensity > 0.78) gIdx = 12; // ▓
        else if (intensity > 0.62) gIdx = 11; // ▒
        else if (intensity > 0.46) gIdx = 10; // ░
        else if (intensity > 0.3) gIdx = 6;   // +
        else gIdx = 2;                        // ·

        const tier = intensity > 0.72 ? 3 : intensity > 0.48 ? 2 : intensity > 0.28 ? 1 : 0;
        ctx.drawImage(skelAtlas, gIdx * cwPx, tier * chPx, cwPx, chPx, xOff + c * cwPx, yOff + r * chPx, cwPx, chPx);
      }
    }
  }

  function drawChartShader(canvas, t) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const { wCss, hCss } = syncCanvasSize(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cols = Math.max(10, Math.floor((wCss - 16) / CW));
    const rows = Math.max(4, Math.floor((hCss - 10) / CH));
    const xOff = Math.round(((wCss - cols * CW) * 0.5) * dpr);
    const yOff = Math.round(((hCss - rows * CH) * 0.5) * dpr);

    const barCount = 14;
    const slot = cols / barCount;

    for (let c = 0; c < cols; c++) {
      const bIdx = Math.floor(c / slot);
      const localC = c - bIdx * slot;
      const isBarCol = localC < Math.max(1, slot - 1.2);
      const waveVal = 0.22 + 0.72 * (
        0.5 + 0.5 * Math.sin(bIdx * 0.54 - t * 2.4) * Math.cos(bIdx * 0.31 - t * 1.15)
      );
      const barTopRow = (1 - waveVal) * (rows - 1);

      for (let r = 0; r < rows; r++) {
        if (!isBarCol || r < Math.floor(barTopRow)) {
          if ((r + c) % 4 === 0 && r < rows - 1) {
            ctx.drawImage(skelAtlas, 2 * cwPx, 0, cwPx, chPx, xOff + c * cwPx, yOff + r * chPx, cwPx, chPx); // faint grid ·
          }
          continue;
        }
        const isCap = r === Math.floor(barTopRow);
        let gIdx;
        if (isCap) {
          const frac = Math.min(7, Math.max(0, Math.floor((1 - (barTopRow - Math.floor(barTopRow))) * 8)));
          gIdx = BAR_START + frac; // ▁..█
        } else {
          gIdx = 12 - Math.min(2, Math.floor((r - barTopRow) * 0.5)); // ▓ -> ▒
        }
        const tier = isCap ? 3 : 2;
        ctx.drawImage(skelAtlas, gIdx * cwPx, tier * chPx, cwPx, chPx, xOff + c * cwPx, yOff + r * chPx, cwPx, chPx);
      }
    }
  }

  function drawRadarShader(canvas, t) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const { wCss, hCss } = syncCanvasSize(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cols = Math.max(16, Math.floor(wCss / CW));
    const rows = Math.max(6, Math.floor(hCss / CH));
    const xOff = Math.round(((wCss - cols * CW) * 0.5) * dpr);
    const yOff = Math.round(((hCss - rows * CH) * 0.5) * dpr);
    const cx = cols * 0.5;
    const cy = rows * 0.5;
    const maxR = Math.max(1, Math.min(cx, cy * (CH / CW)));
    const sweepAngle = (t * 1.9) % (Math.PI * 2);

    for (let r = 0; r < rows; r++) {
      const dy = (r - cy) * (CH / CW);
      for (let c = 0; c < cols; c++) {
        const dx = c - cx;
        const dist = Math.hypot(dx, dy);
        const normD = dist / maxR;
        const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
        const diff = (sweepAngle - ang + Math.PI * 2) % (Math.PI * 2);
        const beam = normD <= 1.25 ? Math.max(0, 1 - diff / 1.35) : 0;

        // Elevation contour underneath (left-to-right drift)
        const field = Math.sin(c * 0.19 - t * 0.6) * Math.cos(r * 0.29 - t * 0.4);
        const contour = Math.max(0, 1 - Math.abs(((field * 2.2) % 1 + 1) % 1 - 0.5) * 6.5);
        const ringHit = normD < 1.15 && Math.abs((normD * 3.0) % 1 - 0.5) < 0.08 ? 0.55 : 0;
        const energy = Math.min(1, beam * 0.85 + contour * 0.35 + ringHit);
        if (energy < 0.14) continue;

        let gIdx;
        if (dist < 1.2) gIdx = 21; // crosshair ┼
        else if (beam > 0.78 && normD < 1.15) gIdx = 12; // ▓
        else if (beam > 0.45) gIdx = 11; // ▒
        else if (ringHit > 0.4) gIdx = 6; // +
        else gIdx = Math.min(11, Math.max(1, Math.floor(energy * 11)));

        const tier = beam > 0.62 ? 3 : beam > 0.25 ? 2 : energy > 0.42 ? 1 : 0;
        ctx.drawImage(skelAtlas, gIdx * cwPx, tier * chPx, cwPx, chPx, xOff + c * cwPx, yOff + r * chPx, cwPx, chPx);
      }
    }
  }

  function step(now) {
    const canvases = document.querySelectorAll(".shader-skel-canvas");
    const spinners = document.querySelectorAll(".glyph-anim[data-glyph-spinner]");
    if (!canvases.length && !spinners.length) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(step);
    if (document.hidden) return;
    if (now - lastDraw < 44) return;
    lastDraw = now;

    const reduced = Boolean(REDUCED_MQ?.matches);
    const t = reduced ? 1.8 : (now - startTime) * 0.001;

    if (!reduced && spinners.length) {
      spinTick = (spinTick + 1) % SPIN_FRAMES.length;
      spinners.forEach((el) => {
        el.textContent = SPIN_FRAMES[spinTick];
      });
    }

    canvases.forEach((canvas) => {
      const kind = canvas.dataset.shaderSkel || "bar";
      if (kind === "chart") drawChartShader(canvas, t);
      else if (kind === "radar") drawRadarShader(canvas, t);
      else drawBarShader(canvas, t, kind);
    });
  }

  function kick() {
    if (rafId) return;
    const hasWork = document.querySelector(".shader-skel-canvas, .glyph-anim[data-glyph-spinner]");
    if (!hasWork) return;
    lastDraw = 0;
    rafId = requestAnimationFrame(step);
  }

  function spinner() {
    return `<span class="glyph-spinner glyph-anim" data-glyph-spinner="true">⠋</span>`;
  }

  function barBox(width = "100%", height = "18px") {
    queueMicrotask(kick);
    return `<div class="shader-skel-box" style="width:${width};height:${height};"><canvas class="shader-skel-canvas" data-shader-skel="bar"></canvas></div>`;
  }

  function kpiCells(count = 4, labels = []) {
    const html = Array.from({ length: count }, (_, i) => `
      <div class="telemetry-cell">
        <div class="telemetry-label">${esc(labels[i] || "ЗАГРУЗКА")}</div>
        <div class="shader-skel-box kpi${i === 1 || i === 2 ? " short" : ""}">
          <canvas class="shader-skel-canvas" data-shader-skel="kpi"></canvas>
        </div>
      </div>
    `).join("");
    queueMicrotask(kick);
    return html;
  }

  function chart() {
    queueMicrotask(kick);
    return `<canvas class="shader-skel-canvas shader-skel-chart" data-shader-skel="chart"></canvas>`;
  }

  function tableRows(rows = 5, colWidths = [68, 72, 66, 28, 58, 52, 82]) {
    const html = Array.from({ length: rows }, (_, r) => `
      <tr>${colWidths.map((w, ci) => {
        const valW = ci >= 3 ? `${Math.max(24, w - (r % 2) * 6)}px` : `${Math.max(38, w - (r % 3) * 10)}%`;
        const h = ci === 6 ? "22px" : ci === 0 ? "18px" : "16px";
        const align = ci === 3 || ci === 4 ? "margin-left:auto;" : "";
        return `<td${ci === 3 || ci === 4 ? ' class="num"' : ""}><div class="shader-skel-box" style="width:${valW};height:${h};${align}"><canvas class="shader-skel-canvas" data-shader-skel="bar"></canvas></div></td>`;
      }).join("")}</tr>
    `).join("");
    queueMicrotask(kick);
    return html;
  }

  function panelShader(title, subtitle = "ОЖИДАНИЕ ОТВЕТА") {
    queueMicrotask(kick);
    return `
      <div class="shader-panel">
        <div class="shader-panel-head">
          <span style="display:inline-flex;align-items:center;gap:8px;">${spinner()} <span>${esc(title)}</span></span>
          <span class="shader-panel-meta">SHADER // SYNC</span>
        </div>
        <canvas class="shader-panel-canvas shader-skel-canvas" data-shader-skel="radar"></canvas>
        <div class="muted" style="font-size:11px;">${esc(subtitle)}</div>
      </div>
    `;
  }

  function inline(text) {
    queueMicrotask(kick);
    return `
      <div class="shader-skel-inline">
        <div class="glyph-panel-inline">${spinner()} <span>${esc(text)}</span></div>
        ${barBox("210px", "14px")}
      </div>
    `;
  }

  function buttonBusy(btn, text) {
    if (!btn) return;
    if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${spinner()} ${esc(text)}`;
    kick();
  }

  function buttonDone(btn) {
    if (!btn) return;
    btn.disabled = false;
    if (btn.dataset.origHtml) {
      btn.innerHTML = btn.dataset.origHtml;
      delete btn.dataset.origHtml;
    }
  }

  function rebuildTheme() {
    if (skelAtlas) buildAtlas();
    if (!rafId) kick();
  }

  return { kick, rebuildTheme, spinner, barBox, kpiCells, chart, tableRows, panelShader, inline, buttonBusy, buttonDone };
})();

// --- BACKGROUND CHARACTER SHADER (GPU Atlas Topographic + Telemetry Wave Field) ---
function initAsciiShaderBackground() {
  const canvas = document.getElementById("asciiShaderBg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const GLYPHS = " .·:-=+*#%░▒▓┼│─";
  const CW = 13;
  const CH = 18;
  const reducedMq = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cwPx = CW * dpr;
  let chPx = CH * dpr;
  let cols = 0;
  let rows = 0;
  let atlas = null;
  let lastFrame = 0;
  let startTime = performance.now();
  let pointerX = -9999;
  let pointerY = -9999;
  let pointerActive = 0;

  function buildAtlas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cwPx = Math.round(CW * dpr);
    chPx = Math.round(CH * dpr);
    atlas = document.createElement("canvas");
    atlas.width = GLYPHS.length * cwPx;
    atlas.height = 4 * chPx;
    const actx = atlas.getContext("2d");
    actx.font = `500 ${Math.round(12 * dpr)}px "JetBrains Mono", Consolas, monospace`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";

    const acc = ThemeManager.getAccentRgb();
    const accHi = ThemeManager.getAccentBrightRgb();
    const light = ThemeManager.isLight();
    const slateLo = light ? "64, 72, 86" : "130, 140, 158";
    const slateHi = light ? "42, 48, 60" : "162, 170, 184";
    const tiers = [
      `rgba(${slateLo}, ${light ? "0.10" : "0.11"})`,
      `rgba(${slateHi}, ${light ? "0.18" : "0.20"})`,
      `rgba(${Math.round(acc.r)}, ${Math.round(acc.g)}, ${Math.round(acc.b)}, 0.24)`,
      `rgba(${Math.round(accHi.r)}, ${Math.round(accHi.g)}, ${Math.round(accHi.b)}, 0.38)`,
    ];
    for (let t = 0; t < tiers.length; t++) {
      actx.fillStyle = tiers[t];
      const cy = t * chPx + chPx * 0.52;
      for (let g = 1; g < GLYPHS.length; g++) {
        actx.fillText(GLYPHS[g], g * cwPx + cwPx * 0.5, cy);
      }
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || window.innerWidth));
    const h = Math.max(240, Math.round(rect.height || window.innerHeight));
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!atlas || nextDpr !== dpr) buildAtlas();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    cols = Math.ceil(w / CW);
    rows = Math.ceil(h / CH);
    drawShaderFrame(reducedMq?.matches ? 4.2 : (performance.now() - startTime) * 0.001);
  }

  function drawShaderFrame(t) {
    if (!atlas || !cols || !rows) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const shaderMode = ThemeManager.getShaderMode();
    if (shaderMode === "off") return;

    const invCols = 1 / Math.max(1, cols);
    const invRows = 1 / Math.max(1, rows);
    const aspect = (rows * CH) / Math.max(1, cols * CW);
    const pCol = pointerX / CW;
    const pRow = pointerY / CH;
    pointerActive *= 0.94;

    const isMapTab = state.activeTab === "maps";
    const tabBoost = isMapTab ? 1.24 : 1.0;

    for (let r = 0; r < rows; r++) {
      const ny = r * invRows;
      const yPx = r * chPx;
      // Vignette suppresses dense center reading area subtly while letting margins/top/bottom breathe
      const vWeight = (0.65 + 0.35 * Math.sin(ny * Math.PI)) * tabBoost;

      for (let c = 0; c < cols; c++) {
        const nx = c * invCols;

        let boost = 0;
        if (pointerActive > 0.02) {
          const pd = Math.hypot((c - pCol) * 0.85, r - pRow);
          if (pd < 8.5) boost = (1 - pd / 8.5) * pointerActive;
        }

        let energy = 0;
        let gIdx = 1;
        let tier = 0;

        if (shaderMode === "matrix") {
          const band = 0.5 + 0.5 * Math.sin(nx * 10.5 - t * 1.4 + Math.sin(ny * 5.0 + c * 0.13) * 0.9);
          const streak = Math.pow(Math.max(0, Math.sin(nx * 24.0 - t * 2.1 + r * 0.45)), 5.0);
          energy = Math.min(1, (band * 0.36 + streak * 0.72 + boost * 0.75) * vWeight);
          if (energy < (isMapTab ? 0.12 : 0.16)) continue;
          gIdx = streak > 0.55 ? 11 : Math.min(GLYPHS.length - 1, Math.max(1, Math.floor(energy * (GLYPHS.length - 1))));
          tier = boost > 0.35 || streak > 0.65 ? 3 : energy > 0.52 ? 2 : 1;
        } else if (shaderMode === "radar") {
          const sweepX = ((t * 0.22) % 1.25) - 0.12;
          const dx = nx - sweepX;
          const wrapDx = dx >= 0 ? dx : dx + 1.25;
          const beam = Math.max(0, 1 - wrapDx * 4.5);
          const grid = (r % 6 === 0 && c % 10 === 0) ? 0.55 : 0;
          energy = Math.min(1, (beam * 0.75 + grid * 0.5 + boost * 0.75) * tabBoost);
          if (energy < 0.12) continue;
          gIdx = grid > 0.4 ? 13 : beam > 0.65 ? 11 : Math.min(10, Math.max(2, Math.floor(energy * 10)));
          tier = beam > 0.55 || boost > 0.35 ? 3 : beam > 0.2 ? 2 : 0;
        } else if (shaderMode === "minimal") {
          const breeze = 0.5 + 0.5 * Math.sin(nx * 4.0 - t * 0.35 + ny * 1.8);
          if ((r + c) % 3 !== 0 && boost < 0.15) continue;
          energy = Math.min(1, (breeze * 0.35 + boost * 0.7) * vWeight);
          if (energy < 0.16) continue;
          gIdx = boost > 0.4 ? 6 : energy > 0.38 ? 3 : 2;
          tier = boost > 0.35 ? 2 : 0;
        } else {
          // Topographic + Telemetry Wave Field (left-to-right)
          const f1 = Math.sin(nx * 5.2 - t * 0.24) * Math.cos(ny * 4.3 - t * 0.17);
          const f2 = 0.55 * Math.sin((nx - ny * 0.9) * 7.8 - t * 0.31);
          const elev = f1 + f2;
          const frac = ((elev * 2.5) % 1 + 1) % 1;
          const iso = Math.max(0, 1 - Math.abs(frac - 0.5) * 9.0);

          const rdx = nx - 0.16;
          const rdy = (ny - 0.16) * aspect;
          const dist = Math.hypot(rdx, rdy);
          const ring = Math.pow(Math.max(0, Math.sin(dist * 15.0 - t * 1.35) * 0.5 + 0.5), 7.0) * Math.max(0.15, 1 - dist * 0.72);

          energy = Math.min(1, (iso * 0.62 + ring * 0.55 + boost * 0.75) * vWeight);
          if (energy < (isMapTab ? 0.1 : 0.13)) continue;

          if (iso > 0.65 && (r + c) % 5 === 0) {
            gIdx = 13; // crosshair ┼
          } else if (ring > 0.45 && iso > 0.25) {
            gIdx = 10 + Math.min(2, Math.floor(energy * 3)); // ░▒▓
          } else {
            gIdx = Math.min(GLYPHS.length - 1, Math.max(1, Math.floor(energy * (GLYPHS.length - 1))));
          }

          tier = boost > 0.35 || ring > 0.48
            ? (energy > 0.58 ? 3 : 2)
            : (energy > 0.48 ? 1 : 0);
        }

        ctx.drawImage(atlas, gIdx * cwPx, tier * chPx, cwPx, chPx, c * cwPx, yPx, cwPx, chPx);
      }
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || reducedMq?.matches) return;
    if (now - lastFrame < 56) return; // ~18 fps calm background cadence
    lastFrame = now;
    drawShaderFrame((now - startTime) * 0.001);
  }

  if (window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches) {
    window.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
      pointerActive = 0.9;
    }, { passive: true });
  }

  window.addEventListener("resize", resize);
  window.addEventListener("eft-theme-change", () => {
    buildAtlas();
    GlyphLoader.rebuildTheme();
    drawShaderFrame((performance.now() - startTime) * 0.001);
    if (state.activeTab === "quest-tree") scheduleTreeFrame(true);
  });
  reducedMq?.addEventListener?.("change", () => {
    drawShaderFrame(4.2);
  });
  resize();
  requestAnimationFrame(loop);
}

// --- Animate UI: Motion Helpers, Indicators & Focus Management ---
function updateGlidingIndicator(containerEl, indicatorEl, activeBtn, topOffset = 0, leftOffset = 0) {
  if (!containerEl || !indicatorEl || !activeBtn) return;
  containerEl.classList.add("has-indicator");
  const x = activeBtn.offsetLeft - leftOffset;
  const y = activeBtn.offsetTop - topOffset;
  indicatorEl.style.width = `${activeBtn.offsetWidth}px`;
  indicatorEl.style.height = `${activeBtn.offsetHeight}px`;
  indicatorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  indicatorEl.classList.add("is-ready");
}

function syncAllIndicators() {
  const nav = document.getElementById("navTabs");
  const navInd = document.getElementById("navTabIndicator");
  updateGlidingIndicator(nav, navInd, nav?.querySelector(".tab-btn.active"));

  const mode = document.getElementById("modeSwitch");
  const modeInd = document.getElementById("modeIndicator");
  updateGlidingIndicator(mode, modeInd, mode?.querySelector(".mode-btn.active"), 2, 2);
}

window.addEventListener("resize", () => requestAnimationFrame(syncAllIndicators));

document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("is-tab-hidden", document.hidden);
});

const modalReturnFocus = new WeakMap();

function syncModalInertState() {
  const appShell = document.querySelector(".app-shell");
  const guideModal = document.getElementById("questGuideModal");
  const lightbox = document.getElementById("screenshotLightbox");
  const settings = document.getElementById("settingsModal");
  const anyOpen = [guideModal, lightbox, settings].some((el) => el?.dataset.open === "true");
  if (appShell) {
    appShell.inert = anyOpen;
    appShell.setAttribute("aria-hidden", anyOpen ? "true" : "false");
  }
  if (guideModal && lightbox) {
    const lbOpen = lightbox.dataset.open === "true";
    guideModal.inert = lbOpen;
    if (guideModal.dataset.open === "true") {
      guideModal.setAttribute("aria-hidden", lbOpen ? "true" : "false");
    }
  }
}

function openAnimatedModal(modalEl, focusSelector = null) {
  if (!modalEl) return;
  if (document.activeElement instanceof HTMLElement) {
    modalReturnFocus.set(modalEl, document.activeElement);
  }
  modalEl.dataset.open = "true";
  modalEl.setAttribute("aria-hidden", "false");
  modalEl.inert = false;
  syncModalInertState();
  if (focusSelector) {
    requestAnimationFrame(() => {
      modalEl.querySelector(focusSelector)?.focus({ preventScroll: true });
    });
  }
}

function closeAnimatedModal(modalEl) {
  if (!modalEl || modalEl.dataset.open !== "true") return;
  modalEl.dataset.open = "false";
  modalEl.setAttribute("aria-hidden", "true");
  syncModalInertState();
  const prev = modalReturnFocus.get(modalEl);
  if (prev && prev.isConnected && typeof prev.focus === "function") {
    requestAnimationFrame(() => prev.focus({ preventScroll: true }));
  }
}

// --- Navigation & Mode ---
document.getElementById("navTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  const tab = btn.dataset.tab;
  if (tab === state.activeTab) return;
  const allBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const prevIdx = allBtns.findIndex((b) => b.dataset.tab === state.activeTab);
  const nextIdx = allBtns.indexOf(btn);
  document.documentElement.style.setProperty("--tab-dir", nextIdx >= prevIdx ? "1" : "-1");

  state.activeTab = tab;
  allBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
  updateGlidingIndicator(document.getElementById("navTabs"), document.getElementById("navTabIndicator"), btn);
  loadActiveTab();
});

document.getElementById("modeSwitch").addEventListener("click", async (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn || btn.dataset.mode === state.mode) return;
  state.mode = btn.dataset.mode;
  localStorage.setItem("eft_assistant_mode", state.mode);
  document.querySelectorAll("#modeSwitch .mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
  updateGlidingIndicator(document.getElementById("modeSwitch"), document.getElementById("modeIndicator"), btn, 2, 2);
  treeCam.hasAutoFitted = false;
  invalidateDataCache(true);
  await loadBootstrap();
  await loadActiveTab();
});

async function setAppLanguage(nextLang, persistServer = true) {
  const normalized = nextLang === "en" ? "en" : "ru";
  if (normalized === state.lang) return;
  state.lang = normalized;
  localStorage.setItem("eft_assistant_lang", state.lang);
  document.querySelectorAll("#langSwitch .mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === state.lang);
  });
  window.applyI18nToDom?.();
  ThemeManager.refreshLabels();
  if (persistServer) {
    api("/api/settings", { method: "POST", body: JSON.stringify({ language: state.lang }) }).catch(() => {});
  }
  treeCam.hasAutoFitted = false;
  invalidateDataCache(true);
  await loadBootstrap();
  await loadActiveTab();
  if (document.getElementById("questGuideModal")?.dataset.open === "true" && currentGuideState.taskId) {
    openQuestGuide(currentGuideState.taskId);
  }
  showToast(t("toast_lang_switched"));
}

document.getElementById("langSwitch")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn[data-lang]");
  if (!btn || btn.dataset.lang === state.lang) return;
  setAppLanguage(btn.dataset.lang, true);
});

document.getElementById("btnSync").addEventListener("click", async () => {
  const btn = document.getElementById("btnSync");
  GlyphLoader.buttonBusy(btn, t("btn_sync_busy"));
  try {
    await api("/api/sync", { method: "POST", body: JSON.stringify({ mode: state.mode, lang: state.lang }) });
    showToast(t("toast_synced"));
    invalidateDataCache(true);
    await loadBootstrap();
    await loadActiveTab();
  } catch (err) {
    showToast((state.lang === "en" ? "Error: " : "Ошибка: ") + err.message);
  } finally {
    GlyphLoader.buttonDone(btn);
  }
});

async function loadActiveTab() {
  if (state.activeTab === "quests") await loadQuests();
  else if (state.activeTab === "quest-tree") await loadQuestTree();
  else if (state.activeTab === "maps") await loadMapView(state.currentMapNorm);
  else if (state.activeTab === "cultist") await loadCultist();
  else if (state.activeTab === "items") await loadItemCounter();
}

async function loadBootstrap() {
  const data = await api(`/api/bootstrap?mode=${state.mode}`);
  state.bootstrap = data;

  const w = data.watcher;
  const pill = document.getElementById("watcherPill");
  const wText = document.getElementById("watcherText");
  if (w.watchLogs && w.logsDirExists) {
    pill.className = "watcher-pill ok";
    const modeTag = w.detectedMode === "pve" ? "PvE" : "PvP";
    wText.textContent = w.activeMapName
      ? `${state.lang === "en" ? "Raid" : "Рейд"}: ${w.activeMapName}`
      : t("watcher_active", { mode: modeTag });
  } else if (!w.watchLogs) {
    pill.className = "watcher-pill";
    wText.textContent = state.lang === "en" ? "Mode: Zero-Touch" : "Режим: Zero-Touch";
  } else {
    pill.className = "watcher-pill warn";
    wText.textContent = state.lang === "en" ? "Logs folder not found" : "Папка Logs не найдена";
  }

  // Populate map selector
  const mapSel = document.getElementById("mapSelect");
  const prev = mapSel.value || state.currentMapNorm;
  mapSel.innerHTML = data.maps
    .filter((m) => m.hasSvg || m.extractCount > 0)
    .map((m) => `<option value="${m.normalizedName}">${esc(t("map_opt_fmt", { name: m.name, ex: m.extractCount, lk: m.lockCount }))}</option>`)
    .join("");
  if ([...mapSel.options].some((o) => o.value === prev)) mapSel.value = prev;
  state.currentMapNorm = mapSel.value;
}

// --- TAB 1: QUESTS ---
async function ensureQuestsData(force = false) {
  if (!force && state.quests && state.questsMode === state.mode && state.questsLang === state.lang) return state.quests;
  const data = await api(`/api/quests?mode=${state.mode}`);
  state.quests = data;
  state.questsMode = state.mode;
  state.questsLang = state.lang;
  return data;
}

function renderQuestsFromState() {
  const data = state.quests;
  if (!data) return;
  const c = data.counts;
  const totalXp = data.history.filter((h) => h.event_type === "completed").reduce((s, h) => s + (h.xp || 0), 0);
  const donePct = Math.round((c.completed / Math.max(1, c.total)) * 100);
  const kappaPct = Math.round((data.kappa.done / Math.max(1, data.kappa.total)) * 100);

  document.getElementById("questKpis").innerHTML = `
    <div class="telemetry-cell">
      <div class="telemetry-label">${esc(t("kpi_done"))}</div>
      <div class="telemetry-row">
        <div class="telemetry-value">${c.completed} / ${c.total}</div>
        <div class="telemetry-delta">${donePct}%</div>
      </div>
      <div class="telemetry-bar"><div class="telemetry-bar-fill green" style="width:${donePct}%"></div></div>
    </div>
    <div class="telemetry-cell">
      <div class="telemetry-label">${esc(t("kpi_active"))}</div>
      <div class="telemetry-row">
        <div class="telemetry-value">${c.active}</div>
        <div class="telemetry-delta">${esc(t("kpi_active_sub"))}</div>
      </div>
    </div>
    <div class="telemetry-cell">
      <div class="telemetry-label">${esc(t("kpi_available"))}</div>
      <div class="telemetry-row">
        <div class="telemetry-value">${c.available}</div>
        <div class="telemetry-delta">${esc(t("kpi_available_sub"))}</div>
      </div>
    </div>
    <div class="telemetry-cell">
      <div class="telemetry-label">${esc(t("kpi_kappa"))}</div>
      <div class="telemetry-row">
        <div class="telemetry-value accent">${data.kappa.done} / ${data.kappa.total}</div>
        <div class="telemetry-delta">${kappaPct}%</div>
      </div>
      <div class="telemetry-bar"><div class="telemetry-bar-fill accent" style="width:${kappaPct}%"></div></div>
    </div>
    <div class="telemetry-cell">
      <div class="telemetry-label">${esc(t("kpi_xp"))}</div>
      <div class="telemetry-row">
        <div class="telemetry-value">${fmtNum(totalXp)}</div>
      </div>
    </div>
  `;

  renderVelocityChart(data.velocity);
  renderQuestNeeds();
  renderQuestTable();
  renderCache.questsSig = `${state.mode}:${state.lang}:${state.dataRev}`;
}

async function loadQuests(force = false) {
  const sig = `${state.mode}:${state.lang}:${state.dataRev}`;
  if (!force && renderCache.questsSig === sig) return;
  if (!state.quests || state.questsMode !== state.mode || state.questsLang !== state.lang) {
    document.getElementById("questKpis").innerHTML = GlyphLoader.kpiCells(5, [
      t("kpi_done"), t("kpi_active"), t("kpi_available"), t("kpi_kappa"), t("kpi_xp"),
    ]);
    document.getElementById("questVelocityChart").innerHTML = GlyphLoader.chart();
    document.getElementById("questNeedsBody").innerHTML = GlyphLoader.inline(state.lang === "en" ? "Loading summary..." : "Загрузка сводки...");
    document.getElementById("questTableBody").innerHTML = GlyphLoader.tableRows(6);
  }
  await ensureQuestsData(force);
  renderQuestsFromState();
}

function renderVelocityChart(velocity) {
  const host = document.getElementById("questVelocityChart");
  if (!velocity.length) {
    host.innerHTML = `<div class="muted" style="font-size:12px;">${esc(t("quests_velocity_empty"))}</div>`;
    return;
  }
  const maxVal = Math.max(1, ...velocity.map((v) => v.completed));
  const w = 560, h = 112, pad = 18;
  const slotW = (w - pad * 2) / velocity.length;
  const bw = Math.max(8, Math.min(28, Math.floor(slotW) - 4));
  const unitQ = state.lang === "en" ? "quests" : "квест.";
  const bars = velocity
    .map((v, i) => {
      const x = pad + i * slotW + (slotW - bw) / 2;
      const bh = Math.max(2, Math.round((v.completed / maxVal) * (h - pad * 2)));
      const y = h - pad - bh;
      return `
        <rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="2" fill="var(--accent)" opacity="0.9">
          <title>${v.date}: ${v.completed} ${unitQ} (${fmtNum(v.xp)} XP)</title>
        </rect>
        <text x="${x + bw / 2}" y="${h - 4}" text-anchor="middle" fill="var(--text-subtle)" font-family="var(--font-mono)" font-size="9">${v.date.slice(5)}</text>
        <text x="${x + bw / 2}" y="${Math.max(11, y - 3)}" text-anchor="middle" fill="var(--text)" font-family="var(--font-mono)" font-size="9.5">${v.completed}</text>
      `;
    })
    .join("");
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:100%;display:block;">
    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--border)" stroke-width="1" />
    ${bars}
  </svg>`;
}

document.querySelectorAll(".subtab-btn[data-need]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.needTab = btn.dataset.need;
    document.querySelectorAll(".subtab-btn[data-need]").forEach((b) => b.classList.toggle("active", b.dataset.need === state.needTab));
    const host = document.getElementById("questNeedsBody");
    renderQuestNeeds();
    if (host) {
      host.classList.remove("subtab-reveal");
      void host.offsetWidth;
      host.classList.add("subtab-reveal");
    }
  });
});

function renderQuestNeeds() {
  if (!state.quests) return;
  const host = document.getElementById("questNeedsBody");
  if (state.needTab === "fir") {
    const list = state.quests.neededFir;
    host.innerHTML = list.length
      ? list.map((it) => `<div class="list-row"><div><b>${esc(it.name)}</b><div class="muted">${esc(it.tasks.slice(0, 2).join(", "))}</div></div><span class="badge amber num">×${it.count} FIR</span></div>`).join("")
      : `<div class="muted">${esc(t("need_fir_empty"))}</div>`;
  } else if (state.needTab === "keys") {
    const list = state.quests.neededKeys;
    host.innerHTML = list.length
      ? list.map((k) => `<div class="list-row"><div><b>${esc(k.name)}</b><div class="muted">${esc(k.tasks.slice(0, 2).join(", "))}</div></div><span class="badge num">${fmtRub(k.price)}</span></div>`).join("")
      : `<div class="muted">${esc(t("need_keys_empty"))}</div>`;
  } else {
    const list = state.quests.history;
    const labels = state.lang === "en"
      ? { completed: ["Completed", "green"], active: ["Started", "blue"], failed: ["Failed", "red"] }
      : { completed: ["Завершён", "green"], active: ["Взят", "blue"], failed: ["Провален", "red"] };
    host.innerHTML = list.length
      ? list.map((h) => {
          const [lbl, cls] = labels[h.event_type] || [h.event_type, ""];
          return `<div class="list-row"><div><b>${esc(h.task_name)}</b><div class="muted">${h.occurred_at.replace("T", " ")} • ${esc(h.source)}</div></div><span class="badge ${cls}">${esc(lbl)}</span></div>`;
        }).join("")
      : `<div class="muted">${esc(t("need_history_empty"))}</div>`;
  }
}

document.getElementById("questSearch").addEventListener("input", renderQuestTable);
document.getElementById("questFilter").addEventListener("change", renderQuestTable);

function renderQuestTable() {
  if (!state.quests) return;
  const q = document.getElementById("questSearch").value.trim().toLowerCase();
  const f = document.getElementById("questFilter").value;

  const allFiltered = state.quests.tasks.filter((t) => {
    if (f === "playable" && t.status !== "active" && t.status !== "available") return false;
    else if (f === "active" && t.status !== "active") return false;
    else if (f === "available" && t.status !== "available") return false;
    else if (f === "completed" && t.status !== "completed") return false;
    else if (f === "kappa" && !t.kappaRequired) return false;
    else if (f === "lightkeeper" && !t.lightkeeperRequired) return false;

    if (q) {
      const hay = `${t.name} ${t.traderName} ${t.mapName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filtered = allFiltered.slice(0, 200);
  const countEl = document.getElementById("questTableCount");
  if (countEl) {
    countEl.textContent = allFiltered.length > filtered.length
      ? t("quests_shown", { shown: filtered.length, total: allFiltered.length })
      : (state.lang === "en" ? `Shown: ${filtered.length}` : `Показано: ${filtered.length}`);
  }

  const tbody = document.getElementById("questTableBody");
  tbody.innerHTML = filtered.map((t) => {
    const tags = [
      t.kappaRequired ? `<span class="badge amber">Kappa</span>` : "",
      t.lightkeeperRequired ? `<span class="badge blue">${esc(state.lang === "en" ? "Lightkeeper" : "Смотритель")}</span>` : "",
    ].filter(Boolean).join(" ");
    const keysStr = (t.neededKeys || []).map((k) => k.shortName || k.name).join(", ");
    const firCount = (t.objectives || []).filter((o) => o.foundInRaid).length;
    const objText = (t.objectives || []).slice(0, 2).map((o) => o.description).filter(Boolean).join(" • ");

    return `
      <tr>
        <td>
          <div class="quest-row-title">
            <span class="quest-row-name">${esc(t.name)}</span>
            ${tags}
            <button type="button" class="btn-guide compact" onclick="openQuestGuide('${esc(t.id)}')">${GUIDE_BOOK_ICO}${esc(window.t("btn_guide"))}</button>
          </div>
          ${objText ? `<div class="quest-row-obj">${esc(objText)}</div>` : ""}
        </td>
        <td>${esc(t.traderName)}</td>
        <td>${esc(t.mapName || window.t("any_map"))}</td>
        <td class="num">${t.minPlayerLevel}</td>
        <td class="num">${fmtNum(t.experience)}</td>
        <td>${keysStr ? `<span class="badge">${esc(keysStr)}</span>` : ""} ${firCount ? `<span class="badge amber">FIR</span>` : ""}</td>
        <td>
          <select class="status-select" data-task-id="${esc(t.id)}">
            <option value="available" ${t.status === "available" ? "selected" : ""}>${esc(window.t("status_available"))}</option>
            <option value="active" ${t.status === "active" ? "selected" : ""}>${esc(window.t("status_active"))}</option>
            <option value="completed" ${t.status === "completed" ? "selected" : ""}>${esc(window.t("status_completed"))}</option>
            <option value="failed" ${t.status === "failed" ? "selected" : ""}>${esc(window.t("status_failed"))}</option>
            <option value="locked" ${t.status === "locked" ? "selected" : ""}>${esc(window.t("status_locked_long"))}</option>
          </select>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7" class="muted">${esc(t("quests_empty"))}</td></tr>`;
}

document.getElementById("questTableBody").addEventListener("change", async (e) => {
  const sel = e.target.closest(".status-select");
  if (!sel) return;
  try {
    await api("/api/quests/status", {
      method: "POST",
      body: JSON.stringify({ mode: state.mode, taskId: sel.dataset.taskId, status: sel.value }),
    });
    showToast(t("toast_status_updated"));
    invalidateDataCache(false);
    await loadQuests(true);
  } catch (err) {
    showToast((state.lang === "en" ? "Error: " : "Ошибка: ") + err.message);
  }
});

document.getElementById("btnImportLogs").addEventListener("click", async () => {
  const btn = document.getElementById("btnImportLogs");
  GlyphLoader.buttonBusy(btn, t("btn_import_busy"));
  try {
    const res = await api("/api/quests/import-logs", { method: "POST", body: "{}" });
    if (!res.ok) {
      showToast(res.error || (state.lang === "en" ? "Logs not found" : "Логи не найдены"));
    } else {
      const sc = res.savedCounts || {};
      showToast(state.lang === "en"
        ? `Folders: ${res.foldersScanned}, new events: ${res.importedEvents} (PvE: ${sc.pve || 0}, PvP: ${sc.regular || 0})`
        : `Папок: ${res.foldersScanned}, новых событий: ${res.importedEvents} (всего в базе PvE: ${sc.pve || 0}, PvP: ${sc.regular || 0})`);
      if (res.activeMode && res.activeMode !== state.mode && (sc[res.activeMode] || 0) > 0 && (sc[state.mode] || 0) === 0) {
        state.mode = res.activeMode;
        document.querySelectorAll("#modeSwitch .mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
        await loadBootstrap();
      }
    }
    invalidateDataCache(true);
    await loadQuests(true);
  } catch (err) {
    showToast((state.lang === "en" ? "Import error: " : "Ошибка импорта: ") + err.message);
  } finally {
    GlyphLoader.buttonDone(btn);
  }
});

// --- TAB 1B: SWIMLANE METRO QUEST TREE ---
const getTreeStatusLabel = (st) => {
  const map = {
    completed: t("status_completed"),
    active: t("status_active"),
    available: t("status_available"),
    locked: t("status_locked"),
    failed: t("status_failed"),
  };
  return map[st] || st || "—";
};

const getTreeStatusShort = (st) => {
  if (st === "completed") return "✓";
  const en = { active: "ACTIVE", available: "AVAIL", locked: "LOCKED", failed: "FAILED" };
  const ru = { active: "АКТИВЕН", available: "ДОСТУПЕН", locked: "ЗАКРЫТ", failed: "ПРОВАЛ" };
  return (state.lang === "en" ? en : ru)[st] || st;
};

const TRADER_ORDER = [
  "Прапор", "Prapor",
  "Терапевт", "Therapist",
  "Лыжник", "Skier",
  "Миротворец", "Peacekeeper",
  "Механик", "Mechanic",
  "Барахольщик", "Ragman",
  "Егерь", "Jaeger",
  "Скупщик", "Fence",
  "Реф", "Ref",
  "Водитель БТР", "BTR Driver",
  "Смотритель", "Lightkeeper",
  "Марафон", "Marathon",
  "Особые / Ивенты", "Special / Events",
  "Разное", "Other",
];

const TRADER_COLORS = {
  "Прапор": "#fb923c", "Prapor": "#fb923c",
  "Терапевт": "#2dd4bf", "Therapist": "#2dd4bf",
  "Лыжник": "#60a5fa", "Skier": "#60a5fa",
  "Миротворец": "#38bdf8", "Peacekeeper": "#38bdf8",
  "Механик": "#e5a93c", "Mechanic": "#e5a93c",
  "Барахольщик": "#a78bfa", "Ragman": "#a78bfa",
  "Егерь": "#84cc16", "Jaeger": "#84cc16",
  "Скупщик": "#94a3b8", "Fence": "#94a3b8",
  "Реф": "#f472b6", "Ref": "#f472b6",
  "Водитель БТР": "#818cf8", "BTR Driver": "#818cf8",
  "Смотритель": "#fb7185", "Lightkeeper": "#fb7185",
  "Марафон": "#34d399", "Marathon": "#34d399",
  "Особые / Ивенты": "#64748b", "Special / Events": "#64748b",
  "Разное": "#64748b", "Other": "#64748b",
};

const TREE_LINE_PALETTE = [
  "#e5a93c",
  "#38bdf8",
  "#4ade80",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#a3e635",
  "#fb923c",
  "#60a5fa",
];

function normalizeGroupTrader(traderName) {
  if (!traderName) return state.lang === "en" ? "Other" : "Разное";
  if (TRADER_COLORS[traderName]) return traderName;
  const cleaned = traderName.split("]]")[0].split(" или ")[0].split(" or ")[0].trim();
  return TRADER_COLORS[cleaned] ? cleaned : traderName;
}

function markerIdForColor(hex) {
  return `treeArrow-${String(hex || "#94a3b8").replace(/[^a-zA-Z0-9]/g, "")}`;
}

const treeCam = {
  zoom: 0.84,
  panX: 20,
  panY: 16,
  stageW: 1200,
  stageH: 700,
  positions: new Map(), // id -> { x, y, w, h }
  hasAutoFitted: false,
  rafId: null,
  lastZoomText: "",
  lastCompact: null,
};

const treeLayout = {
  cards: [],
  cardById: new Map(),
  edges: [],
  lanes: [],
  stageW: 1200,
  stageH: 700,
  mountedIds: new Set(),
  selectedId: null,
  fullChain: new Set(),
  directPrereqs: new Set(),
  directUnlocks: new Set(),
  searchQuery: "",
};

function createTreeNodeElement(c) {
  if (c.el) return c.el;
  const el = document.createElement("div");
  el.className = `tree-node st-${c.stKey}`;
  el.dataset.taskId = c.id;
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.style.left = `${c.x}px`;
  el.style.top = `${c.y}px`;
  el.style.setProperty("--line-color", c.color);
  el.innerHTML = c.innerHtml;
  c.el = el;
  return el;
}

function applyCardHighlightClasses(c) {
  const el = c.el;
  if (!el) return;
  const selId = treeLayout.selectedId;
  const inChain = Boolean(selId && treeLayout.fullChain.has(c.id));
  el.classList.toggle("hl-selected", Boolean(selId && c.id === selId));
  el.classList.toggle("hl-prereq", Boolean(selId && treeLayout.directPrereqs.has(c.id)));
  el.classList.toggle("hl-unlock", Boolean(selId && treeLayout.directUnlocks.has(c.id)));
  el.classList.toggle("hl-chain", Boolean(selId && inChain && c.id !== selId));
  el.classList.toggle("is-dimmed", Boolean(selId && !inChain));
  const q = treeLayout.searchQuery;
  el.classList.toggle("is-search-hit", Boolean(q.length >= 2 && c.nameLower.includes(q)));
}

function drawCanvasArrowHead(ctx, x, y, angle, size = 5.5) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - 0.45), y - size * Math.sin(angle - 0.45));
  ctx.lineTo(x - size * Math.cos(angle + 0.45), y - size * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

function flushTreeFrame() {
  treeCam.rafId = null;
  const vp = document.getElementById("questTreeViewport");
  const stage = document.getElementById("questTreeStage");
  const canvas = document.getElementById("questTreeCanvas");
  const lbl = document.getElementById("treeZoomLabel");
  if (!vp || !stage) return;

  const vw = vp.clientWidth;
  const vh = vp.clientHeight;
  const z = treeCam.zoom;
  const zoomStr = `${Math.round(z * 100)}%`;
  if (lbl && treeCam.lastZoomText !== zoomStr) {
    treeCam.lastZoomText = zoomStr;
    lbl.textContent = zoomStr;
  }
  const isCompact = z < 0.52;
  if (treeCam.lastCompact !== isCompact) {
    treeCam.lastCompact = isCompact;
    vp.classList.toggle("zoom-compact", isCompact);
  }

  // Only render DOM/canvas when tab viewport actually has painted geometry
  if (vw <= 0 || vh <= 0) return;

  const panX = treeCam.panX;
  const panY = treeCam.panY;
  stage.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${z})`;

  const invZ = 1 / Math.max(0.05, z);
  const wLeft = -panX * invZ;
  const wTop = -panY * invZ;
  const wRight = (vw - panX) * invZ;
  const wBottom = (vh - panY) * invZ;

  // 1. Virtualized DOM Node Window (hide DOM cards cleanly in zoomed-out overview LOD)
  const useDomCards = z >= 0.44;
  if (!useDomCards) {
    if (stage.style.display !== "none") stage.style.display = "none";
  } else {
    if (stage.style.display !== "block") stage.style.display = "block";
    const padX = 260;
    const padY = 200;
    const vL = wLeft - padX;
    const vR = wRight + padX;
    const vT = wTop - padY;
    const vB = wBottom + padY;

    const nextVisible = new Set();
    const toAppend = [];

    for (let i = 0; i < treeLayout.cards.length; i++) {
      const c = treeLayout.cards[i];
      if (c.x + c.w >= vL && c.x <= vR && c.y + c.h >= vT && c.y <= vB) {
        nextVisible.add(c.id);
        if (!treeLayout.mountedIds.has(c.id)) {
          const el = createTreeNodeElement(c);
          applyCardHighlightClasses(c);
          toAppend.push(el);
        }
      }
    }

    treeLayout.mountedIds.forEach((id) => {
      if (!nextVisible.has(id)) {
        treeLayout.cardById.get(id)?.el?.remove();
      }
    });

    if (toAppend.length) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < toAppend.length; i++) frag.appendChild(toAppend[i]);
      stage.appendChild(frag);
    }
    treeLayout.mountedIds = nextVisible;
  }

  // 2. Canvas Viewport Layer: Swimlane bands + Frustum-culled Bezier Edges + Overview LOD cards
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(vw * dpr);
  const ch = Math.round(vh * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * panX, dpr * panY);

  const cs = getComputedStyle(document.documentElement);
  const borderCol = cs.getPropertyValue("--border").trim() || "rgba(255,255,255,0.08)";
  const bgCol = cs.getPropertyValue("--bg").trim() || "#0c0d0f";
  const surfaceCol = cs.getPropertyValue("--surface").trim() || "#121417";
  const textCol = cs.getPropertyValue("--text").trim() || "#e6e7eb";
  const mutedCol = cs.getPropertyValue("--text-muted").trim() || "#9398a3";
  const subtleCol = cs.getPropertyValue("--text-subtle").trim() || "#666c77";
  const accentCol = cs.getPropertyValue("--accent").trim() || "#d99b26";
  const accentBrightCol = cs.getPropertyValue("--accent-bright").trim() || "#eab349";

  // Draw visible swimlanes
  for (let i = 0; i < treeLayout.lanes.length; i++) {
    const lane = treeLayout.lanes[i];
    if (lane.startY + lane.laneHeight < wTop || lane.startY > wBottom) continue;

    ctx.fillStyle = lane.bandRgba;
    ctx.fillRect(0, lane.startY, Math.min(440, treeLayout.stageW), lane.laneHeight);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = Math.max(1, 1 * invZ);
    ctx.beginPath();
    ctx.moveTo(0, lane.startY);
    ctx.lineTo(treeLayout.stageW, lane.startY);
    ctx.stroke();

    // Header badge
    const hx = 14;
    const hy = lane.startY + 10;
    if (z >= 0.24) {
      const labelTxt = `${lane.grpName}  ${lane.doneCount}/${lane.total}`;
      ctx.font = `600 12px "IBM Plex Sans", sans-serif`;
      const tw = ctx.measureText(labelTxt).width + 24;
      ctx.fillStyle = bgCol;
      ctx.fillRect(hx, hy, tw, 24);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1;
      ctx.strokeRect(hx, hy, tw, 24);
      ctx.fillStyle = lane.traderColor;
      ctx.fillRect(hx, hy, 3, 24);
      ctx.fillStyle = textCol;
      ctx.textBaseline = "middle";
      ctx.fillText(lane.grpName, hx + 10, hy + 12);
      const nameW = ctx.measureText(lane.grpName).width;
      ctx.font = `500 10.5px "JetBrains Mono", monospace`;
      ctx.fillStyle = mutedCol;
      ctx.fillText(`${lane.doneCount}/${lane.total}`, hx + 16 + nameW, hy + 12);
    }
    if (lane.soloHeaderY !== null && z >= 0.35) {
      ctx.font = `600 10px "JetBrains Mono", monospace`;
      ctx.fillStyle = subtleCol;
      ctx.textBaseline = "top";
      ctx.fillText(state.lang === "en" ? `STANDALONE QUESTS (${lane.soloCount})` : `ОТДЕЛЬНЫЕ КВЕСТЫ (${lane.soloCount})`, 20, lane.soloHeaderY);
    }
  }

  // Draw frustum-culled Bezier edges
  const selId = treeLayout.selectedId;
  const fullChain = treeLayout.fullChain;
  const showArrows = z >= 0.32;

  for (let i = 0; i < treeLayout.edges.length; i++) {
    const e = treeLayout.edges[i];
    if (e.maxX < wLeft || e.minX > wRight || e.maxY < wTop || e.minY > wBottom) continue;

    let stroke = e.baseStroke;
    let width = e.isCross ? 1.3 : 1.8;
    let alpha = e.isCross ? 0.2 : 0.78;
    let dashed = e.isCross;
    let arrow = showArrows;

    if (selId) {
      const directHit = e.from === selId || e.to === selId;
      const chainHit = fullChain.has(e.from) && fullChain.has(e.to);
      if (directHit) {
        stroke = e.from === selId ? "#4ade80" : "#38bdf8";
        width = 2.6;
        alpha = 1;
        dashed = false;
        arrow = true;
      } else if (chainHit) {
        stroke = e.isCross ? accentBrightCol : e.baseStroke;
        width = 2.1;
        alpha = 0.96;
        dashed = false;
        arrow = true;
      } else {
        width = 1.1;
        alpha = 0.09;
        arrow = false;
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.bezierCurveTo(e.cx1, e.cy1, e.cx2, e.cy2, e.x2, e.y2);
    ctx.stroke();

    if (arrow) {
      if (dashed) ctx.setLineDash([]);
      const angle = Math.atan2(e.y2 - e.cy2, e.x2 - e.cx2);
      drawCanvasArrowHead(ctx, e.x2, e.y2, Number.isFinite(angle) ? angle : 0, 5.5);
    }
    ctx.restore();
  }

  // Overview LOD rendering (< 44% zoom): draw crisp mini-cards right on canvas!
  if (!useDomCards) {
    ctx.textBaseline = "middle";
    for (let i = 0; i < treeLayout.cards.length; i++) {
      const c = treeLayout.cards[i];
      if (c.x + c.w < wLeft || c.x > wRight || c.y + c.h < wTop || c.y > wBottom) continue;

      const isSel = selId === c.id;
      const inChain = selId && fullChain.has(c.id);
      const dimmed = selId && !inChain;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.22 : (c.stKey === "completed" ? 0.78 : 0.96);
      ctx.fillStyle = surfaceCol;
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = isSel ? accentCol : (inChain ? accentBrightCol : borderCol);
      ctx.lineWidth = isSel ? 2.5 * invZ : Math.max(1, 1 * invZ);
      ctx.strokeRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x, c.y, 4, c.h);

      if (z >= 0.24) {
        ctx.fillStyle = textCol;
        ctx.font = `600 12px "IBM Plex Sans", sans-serif`;
        const shortName = c.task.name.length > 26 ? `${c.task.name.slice(0, 24)}…` : c.task.name;
        ctx.fillText(shortName, c.x + 12, c.y + c.h * 0.5);
      }
      ctx.restore();
    }
  }
}

function scheduleTreeFrame(immediate = false) {
  if (immediate) {
    if (treeCam.rafId) {
      cancelAnimationFrame(treeCam.rafId);
      treeCam.rafId = null;
    }
    flushTreeFrame();
    return;
  }
  if (!treeCam.rafId) {
    treeCam.rafId = requestAnimationFrame(flushTreeFrame);
  }
}

function applyTreeTransform(immediate = false) {
  scheduleTreeFrame(immediate);
}

function findCardAtWorld(wx, wy) {
  for (let i = treeLayout.cards.length - 1; i >= 0; i--) {
    const c = treeLayout.cards[i];
    if (wx >= c.x && wx <= c.x + c.w && wy >= c.y && wy <= c.y + c.h) {
      return c;
    }
  }
  return null;
}

function fitQuestTreeToView(boxes = null, minClamp = 0.16) {
  const vp = document.getElementById("questTreeViewport");
  if (!vp) return;
  const vw = vp.clientWidth || 1140;
  const vh = vp.clientHeight || 660;
  const list = boxes || [...treeCam.positions.values()];
  if (!list.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  list.forEach((b) => {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  });
  minY = Math.min(minY, 0);
  const pad = 28;
  const contentW = Math.max(300, maxX - minX + pad * 2);
  const contentH = Math.max(220, maxY - minY + pad * 2);
  const rawZ = Math.min(vw / contentW, vh / contentH);
  const z = Math.max(minClamp, Math.min(1.0, rawZ));
  treeCam.zoom = z;
  treeCam.panX = Math.round(Math.max(16, (vw - (maxX - minX) * z) / 2) - minX * z);
  treeCam.panY = Math.round(Math.max(16, (vh - (maxY - minY) * z) / 2) - minY * z);
  applyTreeTransform(true);
}

function frameTreeStart() {
  const vp = document.getElementById("questTreeViewport");
  const vw = vp?.clientWidth || 1140;
  const vh = vp?.clientHeight || 660;
  const list = [...treeCam.positions.values()];
  if (!list.length) return;

  let maxX = -Infinity, maxY = -Infinity;
  list.forEach((b) => {
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  });
  const fitZ = Math.min(1.0, Math.min(vw / (maxX + 48), vh / (maxY + 48)));
  if (fitZ >= 0.56) {
    fitQuestTreeToView(list, 0.56);
    return;
  }
  treeCam.zoom = 0.8;
  treeCam.panX = 16;
  treeCam.panY = 14;
  applyTreeTransform(true);
}

function centerTreeOnTask(taskId) {
  const vp = document.getElementById("questTreeViewport");
  const box = treeCam.positions.get(taskId);
  if (!vp || !box) return;
  const vw = vp.clientWidth || 1140;
  const vh = vp.clientHeight || 660;
  treeCam.zoom = Math.max(treeCam.zoom, 0.85);
  treeCam.panX = Math.round(vw / 2 - (box.x + box.w / 2) * treeCam.zoom);
  treeCam.panY = Math.round(vh / 2 - (box.y + box.h / 2) * treeCam.zoom);
  applyTreeTransform(true);
}

function getChainSets(taskId, byId) {
  const ancestors = new Set();
  const descendants = new Set();
  if (!taskId || !byId.has(taskId)) return { ancestors, descendants };

  const stackUp = [...(byId.get(taskId).prereqs || [])];
  while (stackUp.length) {
    const pid = stackUp.pop();
    if (ancestors.has(pid) || !byId.has(pid)) continue;
    ancestors.add(pid);
    (byId.get(pid).prereqs || []).forEach((pp) => stackUp.push(pp));
  }
  const stackDown = [...(byId.get(taskId).unlocks || [])];
  while (stackDown.length) {
    const uid = stackDown.pop();
    if (descendants.has(uid) || !byId.has(uid)) continue;
    descendants.add(uid);
    (byId.get(uid).unlocks || []).forEach((uu) => stackDown.push(uu));
  }
  return { ancestors, descendants };
}

["treeTraderFilter", "treeImportanceFilter", "treeStatusFilter", "treeChainOnly"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => {
    treeCam.hasAutoFitted = false;
    renderQuestTree();
  });
});

document.getElementById("treeColorMode")?.addEventListener("change", () => {
  renderQuestTree();
});

const treeSearchEl = document.getElementById("treeSearch");
if (treeSearchEl) {
  treeSearchEl.addEventListener("input", () => updateQuestTreeSelection());
  treeSearchEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = treeSearchEl.value.trim().toLowerCase();
    if (!q || !state.quests) return;
    const hit = (state.quests.tasks || []).find((t) => treeCam.positions.has(t.id) && t.name.toLowerCase().includes(q));
    if (hit) {
      state.selectedTreeTaskId = hit.id;
      updateQuestTreeSelection();
      centerTreeOnTask(hit.id);
    }
  });
}

document.getElementById("btnTreeZoomIn")?.addEventListener("click", () => {
  const vp = document.getElementById("questTreeViewport");
  const cx = (vp?.clientWidth || 800) / 2;
  const cy = (vp?.clientHeight || 500) / 2;
  zoomTreeAt(1.22, cx, cy);
});
document.getElementById("btnTreeZoomOut")?.addEventListener("click", () => {
  const vp = document.getElementById("questTreeViewport");
  const cx = (vp?.clientWidth || 800) / 2;
  const cy = (vp?.clientHeight || 500) / 2;
  zoomTreeAt(0.82, cx, cy);
});
document.getElementById("btnTreeFit")?.addEventListener("click", () => fitQuestTreeToView(null, 0.16));
document.getElementById("btnTreeFocusActive")?.addEventListener("click", () => {
  if (!state.quests) return;
  const candidate = (state.quests.tasks || []).find(
    (t) => treeCam.positions.has(t.id) && (t.status === "active" || t.status === "available")
  );
  if (!candidate) return showToast(t("tree_no_active"));
  state.selectedTreeTaskId = candidate.id;
  updateQuestTreeSelection();
  centerTreeOnTask(candidate.id);
});

function zoomTreeAt(factor, vx, vy) {
  const next = Math.max(0.16, Math.min(1.8, treeCam.zoom * factor));
  const ratio = next / treeCam.zoom;
  treeCam.panX = vx - (vx - treeCam.panX) * ratio;
  treeCam.panY = vy - (vy - treeCam.panY) * ratio;
  treeCam.zoom = next;
  scheduleTreeFrame();
}

(function bindTreeViewportInteractions() {
  const vp = document.getElementById("questTreeViewport");
  if (!vp) return;
  let wheelTimer = null;

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.isGesturing = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { state.isGesturing = false; }, 120);
    const r = vp.getBoundingClientRect();
    zoomTreeAt(e.deltaY < 0 ? 1.14 : 0.88, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let drag = null;
  let moved = false;

  vp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, px: treeCam.panX, py: treeCam.panY, startTarget: e.target };
    moved = false;
    state.isGesturing = true;
    vp.classList.add("dragging");
    vp.setPointerCapture(e.pointerId);
  });

  vp.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (moved) {
      treeCam.panX = drag.px + dx;
      treeCam.panY = drag.py + dy;
      scheduleTreeFrame();
    }
  });

  const endDrag = (e) => {
    if (!drag) return;
    state.isGesturing = false;
    vp.classList.remove("dragging");
    try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!moved) {
      let id = e.target.closest?.(".tree-node[data-task-id]")?.dataset?.taskId
        || drag.startTarget?.closest?.(".tree-node[data-task-id]")?.dataset?.taskId
        || null;
      if (!id && treeCam.zoom < 0.44) {
        const r = vp.getBoundingClientRect();
        const wx = (e.clientX - r.left - treeCam.panX) / treeCam.zoom;
        const wy = (e.clientY - r.top - treeCam.panY) / treeCam.zoom;
        id = findCardAtWorld(wx, wy)?.id || null;
      }
      if (id) {
        const chainOnly = document.getElementById("treeChainOnly")?.checked;
        state.selectedTreeTaskId = state.selectedTreeTaskId === id ? null : id;
        if (chainOnly) {
          treeCam.hasAutoFitted = false;
          renderQuestTree();
        } else {
          updateQuestTreeSelection();
        }
      }
    }
    drag = null;
  };
  vp.addEventListener("pointerup", endDrag);
  vp.addEventListener("pointercancel", endDrag);

  vp.addEventListener("dblclick", (e) => {
    if (e.target.closest(".tree-node")) return;
    if (treeCam.zoom < 0.44) {
      const r = vp.getBoundingClientRect();
      const wx = (e.clientX - r.left - treeCam.panX) / treeCam.zoom;
      const wy = (e.clientY - r.top - treeCam.panY) / treeCam.zoom;
      const hit = findCardAtWorld(wx, wy);
      if (hit) {
        state.selectedTreeTaskId = hit.id;
        updateQuestTreeSelection();
        centerTreeOnTask(hit.id);
        return;
      }
    }
    fitQuestTreeToView(null, 0.16);
  });

  vp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest(".tree-node[data-task-id]");
    if (!el) return;
    e.preventDefault();
    const id = el.dataset.taskId;
    state.selectedTreeTaskId = state.selectedTreeTaskId === id ? null : id;
    if (document.getElementById("treeChainOnly")?.checked) {
      treeCam.hasAutoFitted = false;
      renderQuestTree();
    } else {
      updateQuestTreeSelection();
    }
  });
})();

function renderTreeLegend(allTasks) {
  const bar = document.getElementById("treeLegendBar");
  if (!bar) return;
  const activeTrader = document.getElementById("treeTraderFilter")?.value || "all";
  const byTrader = new Map();
  allTasks.forEach((t) => {
    const tr = normalizeGroupTrader(t.traderName);
    if (!byTrader.has(tr)) byTrader.set(tr, { total: 0, done: 0 });
    const entry = byTrader.get(tr);
    entry.total += 1;
    if (t.status === "completed") entry.done += 1;
  });

  const sortedTraders = [...byTrader.keys()].sort((a, b) => {
    const ia = TRADER_ORDER.indexOf(a);
    const ib = TRADER_ORDER.indexOf(b);
    const wa = ia === -1 ? 99 : ia;
    const wb = ib === -1 ? 99 : ib;
    return wa !== wb ? wa - wb : a.localeCompare(b, "ru");
  });

  bar.innerHTML = [
    `<button type="button" class="tree-legend-chip ${activeTrader === "all" ? "active" : ""}" data-legend-trader="all">
      <span>${esc(state.lang === "en" ? "All Branches" : "Все линии")}</span>
      <span class="cnt">${allTasks.length}</span>
    </button>`,
    ...sortedTraders.map((tr) => {
      const stats = byTrader.get(tr);
      const col = TRADER_COLORS[tr] || "#94a3b8";
      return `
        <button type="button" class="tree-legend-chip ${activeTrader === tr ? "active" : ""}" data-legend-trader="${esc(tr)}" title="${esc(tr)}">
          <span class="swatch" style="background:${col};"></span>
          <span>${esc(tr)}</span>
          <span class="cnt">${stats.done}/${stats.total}</span>
        </button>
      `;
    }),
  ].join("");
}

document.getElementById("treeLegendBar")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".tree-legend-chip[data-legend-trader]");
  if (!chip) return;
  const trader = chip.dataset.legendTrader;
  const sel = document.getElementById("treeTraderFilter");
  if (!sel) return;
  sel.value = (sel.value === trader && trader !== "all") ? "all" : trader;
  treeCam.hasAutoFitted = false;
  renderQuestTree();
});

function populateTreeTraderSelect(data) {
  const traderSel = document.getElementById("treeTraderFilter");
  if (!traderSel || !data) return;
  const prev = traderSel.value;
  const traders = [...new Set((data.tasks || []).map((t) => normalizeGroupTrader(t.traderName)).filter(Boolean))].sort((a, b) => {
    const ia = TRADER_ORDER.indexOf(a);
    const ib = TRADER_ORDER.indexOf(b);
    const wa = ia === -1 ? 99 : ia;
    const wb = ib === -1 ? 99 : ib;
    return wa !== wb ? wa - wb : a.localeCompare(b, numLocale());
  });
  traderSel.innerHTML = `<option value="all">${esc(t("tree_all_traders"))}</option>` +
    traders.map((tr) => `<option value="${esc(tr)}">${esc(tr)}</option>`).join("");
  if ([...traderSel.options].some((o) => o.value === prev)) traderSel.value = prev;
}

async function loadQuestTree(force = false) {
  const sig = `${state.mode}:${state.lang}:${state.dataRev}`;
  if (!force && renderCache.treeSig === sig && treeLayout.cards.length) {
    scheduleTreeFrame(true);
    return;
  }
  await ensureQuestsData(force);
  populateTreeTraderSelect(state.quests);
  renderQuestTree();
  renderCache.treeSig = sig;
}

function renderTreeBanner(byId) {
  const banner = document.getElementById("treeSelectedBanner");
  if (!banner) return;
  const selected = state.selectedTreeTaskId ? byId.get(state.selectedTreeTaskId) : null;
  if (!selected) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  const { ancestors, descendants } = getChainSets(selected.id, byId);
  const impTags = [
    selected.kappaRequired ? `<span class="badge amber">${esc(t("badge_kappa"))}</span>` : "",
    selected.lightkeeperRequired ? `<span class="badge">${esc(t("tree_chain_lk"))}</span>` : "",
    (selected.prereqs?.length || selected.unlocks?.length)
      ? `<span class="badge">${state.lang === "en" ? `Chain (before: ${ancestors.size} • after: ${descendants.size})` : `В цепочке (до: ${ancestors.size} • после: ${descendants.size})`}</span>`
      : "",
  ].filter(Boolean).join(" ");
  const prereqChips = (selected.prereqs || []).map((pid) => {
    const pt = byId.get(pid);
    if (!pt) return "";
    const pCol = TRADER_COLORS[normalizeGroupTrader(pt.traderName)] || "#94a3b8";
    return `<button class="btn btn-ghost" style="padding:3px 8px;font-size:12px;" onclick="focusTreeTask('${esc(pid)}', true)"><span class="tree-line-dot" style="background:${pCol};"></span>← ${esc(pt.name)}</button>`;
  }).filter(Boolean).join(" ");
  const unlockChips = (selected.unlocks || []).map((uid) => {
    const ut = byId.get(uid);
    if (!ut) return "";
    const uCol = TRADER_COLORS[normalizeGroupTrader(ut.traderName)] || "#94a3b8";
    return `<button class="btn btn-ghost" style="padding:3px 8px;font-size:12px;" onclick="focusTreeTask('${esc(uid)}', true)"><span class="tree-line-dot" style="background:${uCol};"></span>→ ${esc(ut.name)}</button>`;
  }).filter(Boolean).join(" ");
  const chainOnly = Boolean(document.getElementById("treeChainOnly")?.checked);
  const lineCol = TRADER_COLORS[normalizeGroupTrader(selected.traderName)] || "#94a3b8";
  banner.style.display = "block";
  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="tree-line-dot" style="background:${lineCol};width:8px;height:8px;"></span>
          <b>${esc(selected.name)}</b>
          <span class="badge">${esc(normalizeGroupTrader(selected.traderName) || "—")}</span>
          <span class="badge">${esc(getTreeStatusLabel(selected.status))}</span>
          ${impTags}
          <span class="muted">${esc(t("th_map"))}: ${esc(selected.mapName || t("any_map"))} • ${esc(t("th_lvl"))} ${selected.minPlayerLevel || 1}+</span>
        </div>
        ${prereqChips ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><span class="muted">${esc(t("guide_chain_prev"))}</span>${prereqChips}</div>` : ""}
        ${unlockChips ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><span class="muted">${esc(t("guide_chain_next"))}</span>${unlockChips}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn-guide" onclick="openQuestGuide('${esc(selected.id)}')">${GUIDE_BOOK_ICO}${esc(t("btn_guide"))}</button>
        <button class="btn btn-ghost" onclick="toggleTreeChainIsolation()">${esc(chainOnly ? (state.lang === "en" ? "Show All" : "Показать всю ленту") : t("tree_isolate"))}</button>
        <button class="btn btn-ghost" onclick="setTreeTaskStatus('${esc(selected.id)}','active')">${esc(t("status_active"))}</button>
        <button class="btn btn-primary" onclick="setTreeTaskStatus('${esc(selected.id)}','completed')">${esc(t("status_completed"))}</button>
        <button class="btn btn-ghost" onclick="setTreeTaskStatus('${esc(selected.id)}','available')">${esc(t("tree_reset_status"))}</button>
        <button class="btn btn-ghost" onclick="focusTreeTask(null)">✕</button>
      </div>
    </div>
  `;
}

function updateQuestTreeSelection() {
  if (!state.quests) return;
  const allTasks = state.quests.tasks || [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const selected = state.selectedTreeTaskId ? byId.get(state.selectedTreeTaskId) : null;
  const { ancestors, descendants } = getChainSets(selected?.id, byId);

  treeLayout.selectedId = selected?.id || null;
  treeLayout.directPrereqs = new Set(selected?.prereqs || []);
  treeLayout.directUnlocks = new Set(selected?.unlocks || []);
  treeLayout.fullChain = new Set(selected ? [selected.id, ...ancestors, ...descendants] : []);
  treeLayout.searchQuery = (document.getElementById("treeSearch")?.value || "").trim().toLowerCase();

  renderTreeBanner(byId);

  treeLayout.mountedIds.forEach((id) => {
    const c = treeLayout.cardById.get(id);
    if (c) applyCardHighlightClasses(c);
  });
  scheduleTreeFrame(true);
}

function hexAlphaRgba(hex, alpha) {
  const m = String(hex || "").match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function renderQuestTree() {
  const stage = document.getElementById("questTreeStage");
  if (!stage || !state.quests) return;

  const allTasks = state.quests.tasks || [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const traderVal = document.getElementById("treeTraderFilter")?.value || "all";
  const impVal = document.getElementById("treeImportanceFilter")?.value || "all";
  const stVal = document.getElementById("treeStatusFilter")?.value || "all";
  const colorMode = document.getElementById("treeColorMode")?.value || "chains";
  const chainOnly = Boolean(document.getElementById("treeChainOnly")?.checked);

  renderTreeLegend(allTasks);

  let filtered;
  if (chainOnly && state.selectedTreeTaskId && byId.has(state.selectedTreeTaskId)) {
    const { ancestors, descendants } = getChainSets(state.selectedTreeTaskId, byId);
    const keep = new Set([state.selectedTreeTaskId, ...ancestors, ...descendants]);
    filtered = allTasks.filter((t) => keep.has(t.id));
  } else {
    filtered = allTasks.filter((t) => {
      if (traderVal !== "all" && normalizeGroupTrader(t.traderName) !== traderVal) return false;
      if (impVal === "kappa" && !t.kappaRequired) return false;
      if (impVal === "lightkeeper" && !t.lightkeeperRequired) return false;
      if (impVal === "chains" && !(t.prereqs?.length || t.unlocks?.length)) return false;
      if (stVal === "incomplete" && t.status === "completed") return false;
      if (stVal === "playable" && t.status !== "active" && t.status !== "available") return false;
      return true;
    });
  }

  const statsEl = document.getElementById("treeStatsLabel");
  if (statsEl) {
    statsEl.textContent = state.lang === "en"
      ? `Shown: ${filtered.length} of ${allTasks.length}`
      : `На карте: ${filtered.length} из ${allTasks.length}`;
  }

  renderTreeBanner(byId);

  treeLayout.mountedIds.clear();
  stage.innerHTML = "";
  treeLayout.cards = [];
  treeLayout.cardById.clear();
  treeLayout.edges = [];
  treeLayout.lanes = [];
  treeCam.positions.clear();

  if (!filtered.length) {
    stage.innerHTML = `<div class="muted" style="padding:24px;white-space:nowrap;">${esc(t("quests_empty"))}</div>`;
    scheduleTreeFrame(true);
    return;
  }

  const visibleIds = new Set(filtered.map((t) => t.id));
  const visPrereqs = new Map();
  const visUnlocks = new Map();
  filtered.forEach((t) => {
    visPrereqs.set(t.id, (t.prereqs || []).filter((p) => visibleIds.has(p)));
    visUnlocks.set(t.id, (t.unlocks || []).filter((u) => visibleIds.has(u)));
  });

  // Group into ordered Trader Swimlanes
  const laneGroups = new Map();
  filtered.forEach((t) => {
    const grp = normalizeGroupTrader(t.traderName);
    if (!laneGroups.has(grp)) laneGroups.set(grp, []);
    laneGroups.get(grp).push(t);
  });

  const orderedGroupNames = [...laneGroups.keys()].sort((a, b) => {
    const ia = TRADER_ORDER.indexOf(a);
    const ib = TRADER_ORDER.indexOf(b);
    const wa = ia === -1 ? 99 : ia;
    const wb = ib === -1 ? 99 : ib;
    return wa !== wb ? wa - wb : a.localeCompare(b, "ru");
  });

  const CARD_W = 228;
  const COL_STEP = 292;
  const ROW_STEP = 92;
  const LANE_PAD_X = 20;
  const LANE_HEAD_H = 44;
  const SWIMLANE_GAP = 26;

  const taskMeta = new Map();
  const laneLayouts = [];
  let maxGridCols = 4;

  orderedGroupNames.forEach((grpName, grpIdx) => {
    const gTasks = laneGroups.get(grpName);
    const gIds = new Set(gTasks.map((t) => t.id));
    const gById = new Map(gTasks.map((t) => [t.id, t]));

    const inPrereqs = new Map();
    const inUnlocks = new Map();
    const chainTasks = [];
    const soloTasks = [];

    gTasks.forEach((t) => {
      const ip = (visPrereqs.get(t.id) || []).filter((p) => gIds.has(p));
      const iu = (visUnlocks.get(t.id) || []).filter((u) => gIds.has(u));
      inPrereqs.set(t.id, ip);
      inUnlocks.set(t.id, iu);
      if (ip.length || iu.length) chainTasks.push(t);
      else soloTasks.push(t);
    });

    const colMemo = new Map();
    const getCol = (tid, seen) => {
      if (colMemo.has(tid)) return colMemo.get(tid);
      if (seen.has(tid)) return 0;
      seen.add(tid);
      let c = 0;
      for (const pid of inPrereqs.get(tid) || []) {
        c = Math.max(c, getCol(pid, seen) + 1);
      }
      seen.delete(tid);
      colMemo.set(tid, c);
      return c;
    };
    chainTasks.forEach((t) => getCol(t.id, new Set()));

    const depthMemo = new Map();
    const getSubtreeSpan = (tid, seen) => {
      if (depthMemo.has(tid)) return depthMemo.get(tid);
      if (seen.has(tid)) return 1;
      seen.add(tid);
      let span = 1;
      for (const uid of inUnlocks.get(tid) || []) {
        if ((colMemo.get(uid) || 0) > (colMemo.get(tid) || 0)) {
          span += getSubtreeSpan(uid, seen);
        }
      }
      seen.delete(tid);
      depthMemo.set(tid, span);
      return span;
    };
    chainTasks.forEach((t) => getSubtreeSpan(t.id, new Set()));

    const primaryParent = new Map();
    const treeChildren = new Map();
    chainTasks.forEach((t) => treeChildren.set(t.id, []));
    chainTasks.forEach((t) => {
      const ps = (inPrereqs.get(t.id) || []).filter((p) => (colMemo.get(p) || 0) < (colMemo.get(t.id) || 0));
      if (!ps.length) return;
      ps.sort((a, b) => (colMemo.get(b) - colMemo.get(a)) || ((depthMemo.get(b) || 0) - (depthMemo.get(a) || 0)));
      primaryParent.set(t.id, ps[0]);
      treeChildren.get(ps[0])?.push(t.id);
    });

    const roots = chainTasks.filter((t) => !primaryParent.has(t.id));
    roots.sort((a, b) => ((depthMemo.get(b.id) || 0) - (depthMemo.get(a.id) || 0)) || (a.minPlayerLevel - b.minPlayerLevel) || a.name.localeCompare(b.name, "ru"));

    const occupied = new Set();
    const localGrid = new Map();
    const branchColorIdx = new Map();
    let nextFreeRow = 0;
    let colorCursor = grpIdx * 3;

    const isSpanFree = (r, cStart, cEnd) => {
      for (let c = cStart; c <= cEnd; c++) {
        if (occupied.has(`${r}:${c}`)) return false;
      }
      return true;
    };
    const markSpan = (r, cStart, cEnd) => {
      for (let c = cStart; c <= cEnd; c++) occupied.add(`${r}:${c}`);
    };

    const placeBranch = (tid, prefRow, bIdx, parentCol) => {
      if (localGrid.has(tid)) return;
      const c = colMemo.get(tid) || 0;
      const spanStart = parentCol >= 0 ? Math.min(c, parentCol + 1) : c;
      let r = prefRow;
      if (!isSpanFree(r, spanStart, c)) {
        r = nextFreeRow;
        while (!isSpanFree(r, spanStart, c)) r++;
      }
      markSpan(r, spanStart, c);
      localGrid.set(tid, { col: c, row: r });
      branchColorIdx.set(tid, bIdx);
      nextFreeRow = Math.max(nextFreeRow, r + 1);

      const chIds = [...(treeChildren.get(tid) || [])].sort((a, b) => {
        const dDiff = (depthMemo.get(b) || 0) - (depthMemo.get(a) || 0);
        if (dDiff !== 0) return dDiff;
        return (gById.get(a)?.name || "").localeCompare(gById.get(b)?.name || "", "ru");
      });

      chIds.forEach((cid, i) => {
        if (i === 0) {
          placeBranch(cid, r, bIdx, c);
        } else {
          let nextIdx = (colorCursor++) % TREE_LINE_PALETTE.length;
          if (nextIdx === bIdx) nextIdx = (nextIdx + 1) % TREE_LINE_PALETTE.length;
          placeBranch(cid, nextFreeRow, nextIdx, c);
        }
      });
    };

    roots.forEach((rt) => {
      const idx = (colorCursor++) % TREE_LINE_PALETTE.length;
      placeBranch(rt.id, nextFreeRow, idx, -1);
    });
    chainTasks.forEach((t) => {
      if (!localGrid.has(t.id)) {
        const idx = (colorCursor++) % TREE_LINE_PALETTE.length;
        placeBranch(t.id, nextFreeRow, idx, -1);
      }
    });

    let laneMaxCol = 0;
    localGrid.forEach((pos) => { if (pos.col > laneMaxCol) laneMaxCol = pos.col; });

    const statusOrder = { active: 0, available: 1, locked: 2, completed: 3, failed: 4 };
    soloTasks.sort((a, b) => {
      const sDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (sDiff !== 0) return sDiff;
      return a.minPlayerLevel - b.minPlayerLevel || a.name.localeCompare(b.name, "ru");
    });

    let soloHeaderRow = null;
    if (soloTasks.length) {
      const soloCols = chainTasks.length ? Math.max(4, Math.min(6, laneMaxCol + 1)) : 6;
      const soloStartRow = chainTasks.length ? nextFreeRow + 0.35 : 0;
      if (chainTasks.length) soloHeaderRow = nextFreeRow + 0.05;
      soloTasks.forEach((t, idx) => {
        const col = idx % soloCols;
        const row = soloStartRow + Math.floor(idx / soloCols);
        localGrid.set(t.id, { col, row });
        if (col > laneMaxCol) laneMaxCol = col;
      });
      nextFreeRow = soloStartRow + Math.ceil(soloTasks.length / soloCols);
    }

    if (laneMaxCol + 1 > maxGridCols) maxGridCols = laneMaxCol + 1;

    const traderColor = TRADER_COLORS[grpName] || "#94a3b8";
    const statusColors = {
      completed: "#22c55e",
      active: "#38bdf8",
      available: "#eab349",
      failed: "#ef4444",
      locked: "#64748b",
    };

    gTasks.forEach((t) => {
      let col;
      if (colorMode === "traders") {
        col = traderColor;
      } else if (colorMode === "status") {
        col = statusColors[t.status] || "#64748b";
      } else {
        col = branchColorIdx.has(t.id)
          ? TREE_LINE_PALETTE[branchColorIdx.get(t.id) % TREE_LINE_PALETTE.length]
          : traderColor;
      }
      taskMeta.set(t.id, { color: col, groupTrader: grpName });
    });

    laneLayouts.push({
      grpName,
      traderColor,
      tasks: gTasks,
      localGrid,
      soloHeaderRow,
      soloCount: soloTasks.length,
      doneCount: gTasks.filter((t) => t.status === "completed").length,
      rowsTotal: Math.max(1, nextFreeRow),
    });
  });

  const stageW = Math.max(960, LANE_PAD_X * 2 + maxGridCols * COL_STEP);
  let cursorY = 0;

  laneLayouts.forEach((lane) => {
    const startY = cursorY;
    const bodyHeight = Math.ceil(lane.rowsTotal * ROW_STEP) + 18;
    const laneHeight = LANE_HEAD_H + bodyHeight;
    cursorY += laneHeight + SWIMLANE_GAP;

    const soloHeaderY = lane.soloHeaderRow !== null
      ? startY + LANE_HEAD_H + Math.round(lane.soloHeaderRow * ROW_STEP) - 4
      : null;

    treeLayout.lanes.push({
      grpName: lane.grpName,
      traderColor: lane.traderColor,
      bandRgba: hexAlphaRgba(lane.traderColor, 0.055),
      startY,
      laneHeight,
      soloHeaderY,
      soloCount: lane.soloCount,
      doneCount: lane.doneCount,
      total: lane.tasks.length,
    });

    const baseTop = startY + LANE_HEAD_H;
    lane.tasks.forEach((t) => {
      const g = lane.localGrid.get(t.id);
      if (!g) return;
      const x = LANE_PAD_X + g.col * COL_STEP;
      const y = baseTop + Math.round(g.row * ROW_STEP);
      // Deterministic box height eliminates synchronous 883-card DOM measurement thrashing
      const h = t.name.length > 26 ? 76 : 62;
      const meta = taskMeta.get(t.id) || { color: lane.traderColor, groupTrader: lane.grpName };
      const stKey = t.status || "locked";
      const stLabel = getTreeStatusShort(stKey);
      const crossDeps = (visPrereqs.get(t.id) || []).filter((pid) => {
        const pt = byId.get(pid);
        return pt && normalizeGroupTrader(pt.traderName) !== lane.grpName;
      }).length;

      const badgeTag = t.kappaRequired
        ? `<span class="badge amber" style="font-size:9px;padding:0 4px;">KAPPA</span>`
        : (t.lightkeeperRequired ? `<span class="badge" style="font-size:9px;padding:0 4px;">${esc(window.t("badge_lk"))}</span>` : "");

      const innerHtml = `
        <div class="tree-node-top">
          <span class="tree-line-tag"><span class="tree-line-dot"></span>${esc(meta.groupTrader)}</span>
          <span style="display:inline-flex;align-items:center;gap:4px;">
            ${badgeTag}
            <span class="tree-st-pill ${stKey}">${esc(stLabel)}</span>
          </span>
        </div>
        <div class="tree-node-title">${esc(t.name)}</div>
        <div class="tree-node-meta tree-node-extra">
          <span>${esc(t.mapName || window.t("any_map"))}${t.minPlayerLevel > 1 ? ` • ${window.t("th_lvl")}.${t.minPlayerLevel}` : ""}</span>
          <span>${crossDeps ? `⇄${crossDeps} ` : ""}←${t.prereqs?.length || 0} →${t.unlocks?.length || 0}</span>
        </div>
      `;

      const box = { x, y, w: CARD_W, h };
      treeCam.positions.set(t.id, box);
      const cardObj = {
        id: t.id,
        task: t,
        nameLower: t.name.toLowerCase(),
        x, y, w: CARD_W, h,
        color: meta.color,
        groupTrader: meta.groupTrader,
        stKey,
        innerHtml,
        el: null,
      };
      treeLayout.cards.push(cardObj);
      treeLayout.cardById.set(t.id, cardObj);
    });
  });

  treeLayout.stageW = stageW;
  treeLayout.stageH = Math.max(420, cursorY + 24);
  treeCam.stageW = treeLayout.stageW;
  treeCam.stageH = treeLayout.stageH;

  // Precompute Bezier edge geometry + bounding boxes for ultra-fast Canvas frustum culling
  filtered.forEach((t) => {
    const toBox = treeCam.positions.get(t.id);
    if (!toBox) return;
    const toMeta = taskMeta.get(t.id) || { color: "#94a3b8", groupTrader: "" };
    (visPrereqs.get(t.id) || []).forEach((pid) => {
      const fromBox = treeCam.positions.get(pid);
      if (!fromBox) return;
      const fromMeta = taskMeta.get(pid) || { color: "#94a3b8", groupTrader: "" };
      const isCross = fromMeta.groupTrader !== toMeta.groupTrader;

      const x1 = fromBox.x + fromBox.w;
      const y1 = fromBox.y + fromBox.h / 2;
      const x2 = toBox.x - 4;
      const y2 = toBox.y + toBox.h / 2;
      const dx = (!isCross && x2 >= x1)
        ? Math.max(28, Math.min(62, (x2 - x1) * 0.48 + Math.min(22, Math.abs(y2 - y1) * 0.06)))
        : Math.max(40, Math.min(110, Math.abs(x2 - x1) * 0.38));

      const cx1 = x1 + dx;
      const cy1 = y1;
      const cx2 = x2 - dx;
      const cy2 = y2;

      treeLayout.edges.push({
        from: pid,
        to: t.id,
        x1, y1, x2, y2,
        cx1, cy1, cx2, cy2,
        minX: Math.min(x1, x2, cx1, cx2) - 8,
        maxX: Math.max(x1, x2, cx1, cx2) + 8,
        minY: Math.min(y1, y2, cy1, cy2) - 8,
        maxY: Math.max(y1, y2, cy1, cy2) + 8,
        baseStroke: toMeta.color,
        isCross,
      });
    });
  });

  if (!treeCam.hasAutoFitted) {
    treeCam.hasAutoFitted = true;
    frameTreeStart();
  }
  updateQuestTreeSelection();
}

window.toggleTreeChainIsolation = () => {
  const chk = document.getElementById("treeChainOnly");
  if (!chk) return;
  chk.checked = !chk.checked;
  treeCam.hasAutoFitted = false;
  renderQuestTree();
};

window.focusTreeTask = (id, center = false) => {
  state.selectedTreeTaskId = id;
  if (id && !treeCam.positions.has(id)) {
    const tSel = document.getElementById("treeTraderFilter");
    const iSel = document.getElementById("treeImportanceFilter");
    const sSel = document.getElementById("treeStatusFilter");
    const cChk = document.getElementById("treeChainOnly");
    if (tSel) tSel.value = "all";
    if (iSel) iSel.value = "all";
    if (sSel) sSel.value = "all";
    if (cChk) cChk.checked = false;
    renderQuestTree();
  } else {
    updateQuestTreeSelection();
  }
  if (id && center) centerTreeOnTask(id);
};

window.setTreeTaskStatus = async (taskId, status) => {
  await api("/api/quests/status", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, taskId, status }),
  });
  showToast(t("toast_status_updated"));
  invalidateDataCache(false);
  await loadQuestTree(true);
};

// --- TAB 2: MAPS ---
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

window.toggleSelectMapTask = (taskId, exclusive = true) => {
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
  const total = cards.length;
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

    let statusMatches = true;
    if (statusFilter === "active") {
      statusMatches = (st === "active" || st === "available");
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
    noMatchEl.innerHTML = state.lang === "en"
      ? `No quests match «<b>${esc(query)}</b>».<br><button class="btn btn-ghost" style="margin-top:8px;font-size:11px;" onclick="clearMapTaskSearch()">Clear search</button>`
      : `По запросу «<b>${esc(query)}</b>» квестов не найдено.<br><button class="btn btn-ghost" style="margin-top:8px;font-size:11px;" onclick="clearMapTaskSearch()">Очистить поиск</button>`;
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

  // Render SVG
  if (data.svg) {
    svgHost.innerHTML = data.svg;
    const svgEl = svgHost.querySelector("svg");
    if (svgEl) {
      svgEl.style.width = "1000px";
      svgEl.style.height = "auto";
      svgEl.style.display = "block";
    }
  } else {
    svgHost.innerHTML = `<div style="width:1000px;height:620px;display:flex;align-items:center;justify-content:center;color:#71717a;">${esc(t("map_no_svg", { name: mp.name }))}</div>`;
  }

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
      <div class="${cardCls}" data-task-id="${esc(t.taskId)}" data-status="${esc(t.status)}" data-search="${esc(searchStr)}" onclick="toggleSelectMapTask('${esc(t.taskId)}', true)">
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
  state.selectedMapTaskIds = new Set([taskId]);
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

  document.querySelectorAll("#mapPinsHost .map-pin.pin-lock").forEach((pinEl) => {
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

function renderMapPins() {
  const pinsHost = document.getElementById("mapPinsHost");
  if (!state.currentMapData) return;
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
      const tooltipHtml = `
        <div class="map-tooltip-header">
          <div class="map-tooltip-title" style="color:${titleCol};">${esc(ex.name)}</div>
          <span class="badge ${badgeCls}" style="font-size:10px;">${esc(factionLabel)}</span>
        </div>
        <div class="map-tooltip-body">
          <div>${esc(t("map_extract_label"))} <b>${esc(factionLabel)}</b></div>
          ${ex.switch ? `<div style="color:var(--accent-bright);margin-top:3px;">${esc(t("map_extract_switch"))}</div>` : ""}
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
              <span>${esc(t("map_extract_foot"))}</span>
            </div>
          </div>
          <button type="button" class="map-popover-close" onclick="closeMapPinPopover()" aria-label="Close">✕</button>
        </div>
        <div class="map-popover-body">
          <div>${esc(t("map_faction_prefix"))} <b>${esc(factionLabel)}</b></div>
          ${ex.switch ? `<div style="color:var(--accent-bright);">${esc(t("map_extract_switch"))}</div>` : `<div class="muted">${esc(t("map_extract_no_cond"))}</div>`}
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
    (questMarkers || []).forEach((qm) => {
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

      if (hasSelection && !state.selectedMapTaskIds.has(qm.taskId)) {
        return;
      }
      const isSelected = hasSelection && state.selectedMapTaskIds.has(qm.taskId);
      let cls = "pin-quest";
      if (isCompleted) {
        cls = "pin-quest-completed";
      } else if (isLocked) {
        cls = "pin-quest-other";
      }
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
        qm.uv,
        cls,
        `${esc(qm.taskName)}${isCompleted ? " ✓" : ""}`,
        detailHtml,
        qm.taskId,
        tooltipHtml
      );
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
    const overlapBuckets = new Map();
    const seenBossSpots = new Set();
    (map.bosses || []).forEach((b) => {
      if (b.isBoss === false) return;
      (b.spawnLocations || []).forEach((sl) => {
        if (!sl.uv) return;
        const spotKey = `${b.name}|${sl.name}`;
        if (seenBossSpots.has(spotKey)) return;
        seenBossSpots.add(spotKey);

        const bucketKey = `${Math.round(sl.uv[0] * 40)}:${Math.round(sl.uv[1] * 40)}`;
        const stackIdx = overlapBuckets.get(bucketKey) || 0;
        overlapBuckets.set(bucketKey, stackIdx + 1);

        let uv = sl.uv;
        if (stackIdx > 0) {
          const ang = stackIdx * 2.15;
          const r = 0.014 + Math.floor(stackIdx / 3) * 0.009;
          uv = [
            Math.max(0.02, Math.min(0.98, sl.uv[0] + Math.cos(ang) * r)),
            Math.max(0.02, Math.min(0.98, sl.uv[1] + Math.sin(ang) * r * 1.25)),
          ];
        }

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
          uv,
          "pin-boss",
          lbl,
          detailHtml,
          null,
          tooltipHtml
        );
      });
    });
  }

  const curFloor = state.activeMapFloor || "all";
  pinsHost.innerHTML = pins.map((p, idx) => {
    const dim = curFloor !== "all" && p.floorId && p.floorId !== curFloor ? " is-dimmed-floor" : "";
    const sel = state.selectedLockPinId && p.lockId && p.lockId === state.selectedLockPinId ? " pin-selected" : "";
    return `<div class="map-pin ${p.cls}${dim}${sel}" style="left:${p.left}%;top:${p.top}%;" data-pin-idx="${idx}" data-floor-id="${esc(p.floorId || "")}">${p.label}</div>`;
  }).join("");
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
  state.selectedLockPinId = null;
};

window.addEventListener("resize", repositionMapPopover);

document.getElementById("mapPinsHost").addEventListener("click", (e) => {
  const el = e.target.closest(".map-pin");
  if (!el) return;
  e.stopPropagation();
  const pins = document.getElementById("mapPinsHost")._pins || [];
  const p = pins[Number(el.dataset.pinIdx)];
  if (!p) return;
  document.querySelectorAll("#mapPinsHost .map-pin.pin-selected").forEach((n) => n.classList.remove("pin-selected"));
  el.classList.add("pin-selected");
  state.selectedLockPinId = p.lockId || null;

  openMapPinPopover(p.uv, p.detailHtml, el);
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
      return;
    }
    const pinEl = e.target.closest(".map-pin");
    if (pinEl) {
      if (activeMapPopover.pinEl && pinEl === activeMapPopover.pinEl) {
        hideMapTooltip();
        return;
      }
      const idx = Number(pinEl.dataset.pinIdx);
      const pins = document.getElementById("mapPinsHost")?._pins || [];
      const p = pins[idx];
      if (p && p.tooltipHtml) {
        if (hoveredMapPinIdx !== idx) {
          hoveredMapPinIdx = idx;
          showMapTooltip(p.tooltipHtml, e);
        } else {
          positionMapTooltip(e);
        }
        return;
      }
    }

    // Check SVG map elements with titles or meaningful labels
    const svgTarget = e.target.closest("g[id], text, path[title]");
    if (svgTarget && !pinEl) {
      const rawTitle = svgTarget.getAttribute("title") || svgTarget.id || "";
      if (rawTitle && !rawTitle.startsWith("path") && !rawTitle.startsWith("svg_") && rawTitle.length > 2 && isNaN(Number(rawTitle))) {
        const cleanTitle = rawTitle.replace(/[-_]/g, " ");
        if (hoveredMapPinIdx !== "svg-" + rawTitle) {
          hoveredMapPinIdx = "svg-" + rawTitle;
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
  });
}

function hideMapTooltip() {
  if (hoveredMapPinIdx !== null) {
    hoveredMapPinIdx = null;
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

// --- QUEST GUIDE MODAL & LIGHTBOX ---
let guideLoadSeq = 0;

function hideGuideLoaderHud() {
  const hud = document.getElementById("guideLoaderHud");
  if (!hud) return;
  hud.dataset.open = "false";
  hud.setAttribute("aria-hidden", "true");
}

function showGuideLoaderHud(label) {
  const hud = document.getElementById("guideLoaderHud");
  const title = document.getElementById("guideLoaderTitle");
  if (title) title.textContent = label || t("guide_hud_title");
  if (hud) {
    hud.dataset.open = "true";
    hud.setAttribute("aria-hidden", "false");
    GlyphLoader.kick();
  }
}

document.getElementById("btnCancelGuideLoad")?.addEventListener("click", () => {
  guideLoadSeq++;
  hideGuideLoaderHud();
});

function preloadImagesWithTimeout(urls, timeoutMs = 6500) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (!unique.length) return Promise.resolve();
  const loaders = unique.map((src) => new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const done = () => resolve();
    img.addEventListener("load", () => {
      if (typeof img.decode === "function") img.decode().catch(() => {}).finally(done);
      else done();
    }, { once: true });
    img.addEventListener("error", done, { once: true });
    img.src = src;
    if (img.complete) done();
  }));
  return Promise.race([
    Promise.allSettled(loaders),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function getObjectiveTypeLabel(type) {
  const en = {
    findQuestItem: ["Quest Item", "amber"],
    giveQuestItem: ["Hand Over", "amber"],
    findItem: ["Find", ""],
    giveItem: ["Hand Over", ""],
    plantItem: ["Plant", "amber"],
    mark: ["Mark", "amber"],
    visit: ["Locate", ""],
    extract: ["Survive & Extract", "green"],
    shoot: ["Eliminate", "red"],
    skill: ["Skill", ""],
    traderLevel: ["Reputation", ""],
    custom: ["Task", ""],
  };
  const ru = {
    findQuestItem: ["Квест. предмет", "amber"],
    giveQuestItem: ["Сдать предмет", "amber"],
    findItem: ["Найти", ""],
    giveItem: ["Передать", ""],
    plantItem: ["Заложить", "amber"],
    mark: ["Отметить", "amber"],
    visit: ["Разведать", ""],
    extract: ["Выжить и выйти", "green"],
    shoot: ["Устранить", "red"],
    skill: ["Навык", ""],
    traderLevel: ["Репутация", ""],
    custom: ["Задача", ""],
  };
  return (state.lang === "en" ? en : ru)[type] || [state.lang === "en" ? "Objective" : "Цель", ""];
}

function getQuestStatusBadge(statusKey) {
  const map = {
    active: [t("status_active"), "amber"],
    available: [t("status_available"), ""],
    completed: [t("status_completed"), "green"],
    failed: [t("status_failed"), "red"],
    locked: [t("status_locked"), ""],
  };
  return map[statusKey] || [t("status_available"), ""];
}

let currentGuideState = { taskId: null, data: null, subtab: "steps" };

window.openQuestGuide = async (taskId, forceRefresh = false) => {
  const modal = document.getElementById("questGuideModal");
  if (!modal) return;

  const reqId = ++guideLoadSeq;
  const activeTask = (state.currentMapData?.activeMapTasks || []).find((x) => x.taskId === taskId)
    || (state.quests?.tasks || []).find((x) => x.id === taskId);
  const taskName = activeTask?.taskName || activeTask?.name || (state.lang === "en" ? "Quest" : "Квест");

  showGuideLoaderHud(t("guide_hud_loading", { name: taskName }));

  try {
    let data = await api(`/api/tasks/${encodeURIComponent(taskId)}/guide?mode=${state.mode}&lang=${state.lang}${forceRefresh ? "&force=1" : ""}`);
    if (reqId !== guideLoadSeq) return;

    if (data?.error && activeTask) {
      data = {
        taskId,
        taskName,
        traderName: activeTask.traderName || "",
        wikiLink: activeTask.wikiLink || "https://tarkov.dev/tasks",
        guideSource: "tarkov.dev",
        source: state.lang,
        wikiAvailable: false,
        wikiSections: [],
        wikiImages: [],
        images: [],
        briefing: {
          taskId,
          name: taskName,
          traderName: activeTask.traderName || "",
          mapName: activeTask.mapName || t("any_map"),
          minPlayerLevel: activeTask.minPlayerLevel || 1,
          experience: activeTask.experience || 0,
          kappaRequired: Boolean(activeTask.kappaRequired),
          lightkeeperRequired: Boolean(activeTask.lightkeeperRequired),
          objectives: activeTask.objectives || [],
          neededKeys: activeTask.neededKeys || [],
          prereqs: [],
          unlocks: [],
          rewards: {},
        },
      };
    } else if (data?.error) {
      throw new Error(data.error);
    }

    currentGuideState = { taskId, data, subtab: "steps" };
    renderQuestGuideModal(data);

    const thumbUrl = mediaSrc(data.briefing?.taskImageLink || "");
    const allImgUrls = [thumbUrl, ...(data.images || []).slice(0, 12).map(mediaSrc)].filter(Boolean);
    if (allImgUrls.length) {
      const photosLbl = state.lang === "en" ? "Screenshots" : "Фото";
      showGuideLoaderHud(`${data.taskName || taskName} • ${photosLbl} (${allImgUrls.length})`);
      await preloadImagesWithTimeout(allImgUrls, 4500);
    }
    if (reqId !== guideLoadSeq) return;

    hideGuideLoaderHud();
    openAnimatedModal(modal, "#btnCloseGuideModal");
  } catch (err) {
    if (reqId !== guideLoadSeq) return;
    hideGuideLoaderHud();
    showToast(`${t("guide_error_prefix")}${err.message || err}`);
  }
};

function renderQuestGuideModal(data) {
  const titleEl = document.getElementById("guideModalTitle");
  const metaEl = document.getElementById("guideModalMeta");
  const badgesEl = document.getElementById("guideModalBadges");
  const heroWrap = document.getElementById("guideHeroThumbWrap");
  const heroImg = document.getElementById("guideHeroThumb");
  const wikiLinkEl = document.getElementById("guideModalWikiLink");
  const footerActEl = document.getElementById("guideFooterActions");
  const bodyEl = document.getElementById("guideModalBody");

  const br = data.briefing || {};
  const finalTitle = br.name || data.taskName || (state.lang === "en" ? "Quest" : "Квест");
  const qTask = (state.quests?.tasks || []).find((x) => x.id === data.taskId);
  const statusKey = qTask?.status || "available";
  const [statusLabel, statusCls] = getQuestStatusBadge(statusKey);

  titleEl.textContent = finalTitle;
  const srcLabel = data.wikiAvailable
    ? t(data.source === "en" ? "guide_src_help_en" : "guide_src_help_ru")
    : t("guide_src_dev");
  metaEl.textContent = `${br.traderName || data.traderName || "—"} • ${br.mapName || t("any_map")} • ${srcLabel}`;

  if (badgesEl) {
    badgesEl.innerHTML = [
      `<span class="badge ${statusCls}">${esc(statusLabel)}</span>`,
      br.kappaRequired ? `<span class="badge amber">${esc(t("badge_kappa"))}</span>` : "",
      br.lightkeeperRequired ? `<span class="badge">${esc(t("tree_chain_lk"))}</span>` : "",
      br.restartable ? `<span class="badge">${esc(t("guide_restartable"))}</span>` : "",
    ].filter(Boolean).join("");
  }

  const previewImg = mediaSrc(br.taskImageLink || (data.images && data.images[0]) || "");
  if (heroWrap && heroImg) {
    if (previewImg) {
      heroImg.src = previewImg;
      heroImg.alt = finalTitle;
      heroWrap.style.display = "block";
      heroWrap.onclick = () => openScreenshotLightbox(previewImg, finalTitle);
    } else {
      heroWrap.style.display = "none";
      heroImg.removeAttribute("src");
    }
  }

  const extUrl = data.guideUrl || br.wikiLink || data.wikiLink;
  if (wikiLinkEl) {
    if (extUrl) {
      wikiLinkEl.href = extUrl;
      wikiLinkEl.textContent = extUrl.includes("tarkov.help") ? t("guide_btn_open_help") : t("guide_btn_open_dev");
      wikiLinkEl.style.display = "inline-flex";
    } else {
      wikiLinkEl.style.display = "none";
    }
  }

  const refreshBtn = document.getElementById("btnRefreshGuide");
  if (refreshBtn) {
    refreshBtn.onclick = () => openQuestGuide(data.taskId, true);
  }

  if (footerActEl) {
    footerActEl.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="setGuideTaskStatus('${esc(data.taskId)}', 'active')">${esc(t("guide_mark_active"))}</button>
      <button type="button" class="btn btn-primary" onclick="setGuideTaskStatus('${esc(data.taskId)}', 'completed')">${esc(t("guide_mark_completed"))}</button>
      <button type="button" class="btn btn-secondary" id="btnCloseGuideModalBottom">${esc(t("guide_btn_close"))}</button>
    `;
    document.getElementById("btnCloseGuideModalBottom")?.addEventListener("click", closeQuestGuide);
  }

  const objs = br.objectives || [];
  const keys = br.neededKeys || [];
  const prereqs = br.prereqs || [];
  const unlocks = br.unlocks || [];
  const rew = br.rewards || {};
  const rewCount = (rew.items?.length || 0) + (rew.standing?.length || 0) + (rew.offers?.length || 0) + (rew.crafts?.length || 0) + (rew.skills?.length || 0);
  const wikiImgs = (data.wikiImages && data.wikiImages.length)
    ? data.wikiImages
    : (data.images || []).map((url) => ({ url, caption: "" }));

  const itemLbl = state.lang === "en" ? "Item:" : "Предмет:";
  const markerLbl = state.lang === "en" ? "Marker:" : "Маркер:";
  const keyLbl = state.lang === "en" ? "Key:" : "Ключ:";
  const objDefaultLbl = state.lang === "en" ? "Complete objective" : "Выполнить условие";

  const objectivesHtml = objs.length
    ? `<div class="guide-obj-list">${objs.map((ob, idx) => {
        const [tLbl, tCls] = getObjectiveTypeLabel(ob.type);
        const mapStr = (ob.mapNames || []).join(", ");
        const itemTag = ob.itemName
          ? `<div class="muted" style="font-size:11px;margin-top:2px;">${itemLbl} <b>${esc(ob.itemName)}</b>${ob.count > 1 ? ` ×${ob.count}` : ""}</div>`
          : (ob.markerItemName ? `<div class="muted" style="font-size:11px;margin-top:2px;">${markerLbl} <b>${esc(ob.markerItemName)}</b></div>` : "");
        const keyStr = (ob.requiredKeys || []).length
          ? `<div class="muted" style="font-size:11px;margin-top:2px;">${keyLbl} ${ob.requiredKeys.map((k) => esc(k.name)).join(" / ")}</div>`
          : "";
        return `
          <div class="guide-obj-row">
            <span class="guide-obj-num">${String(idx + 1).padStart(2, "0")}</span>
            ${ob.itemIcon ? `<img class="guide-obj-ico" src="${esc(ob.itemIcon)}" alt="" referrerpolicy="no-referrer" />` : ""}
            <div style="flex:1;min-width:0;">
              <div style="font-size:12.5px;font-weight:500;color:var(--text);">${esc(ob.description || ob.itemName || objDefaultLbl)}</div>
              ${itemTag}
              ${keyStr}
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;">
                <span class="badge ${tCls}">${esc(tLbl)}</span>
                ${ob.foundInRaid ? `<span class="badge amber">FIR</span>` : ""}
                ${ob.optional ? `<span class="badge">${esc(t("guide_optional"))}</span>` : ""}
                ${ob.count > 1 ? `<span class="badge num">×${ob.count}</span>` : ""}
                ${mapStr ? `<span class="badge">${esc(mapStr)}</span>` : ""}
              </div>
            </div>
          </div>
        `;
      }).join("")}</div>`
    : `<div class="muted" style="font-size:12px;">${esc(t("guide_rewards_empty"))}</div>`;

  const metaSideHtml = `
    <div class="guide-card">
      <div class="guide-card-title"><span>${esc(t("guide_chain_title"))} &amp; ${esc(t("guide_prep_keys"))}</span></div>
      ${keys.length ? `
        <div style="margin-bottom:10px;">
          <div class="muted" style="font-size:11px;margin-bottom:4px;">${esc(t("guide_prep_keys"))}:</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${keys.map((k) => `
              <div class="list-row" style="padding:5px 8px;">
                <b style="font-size:12px;">${esc(k.name)}</b>
                ${k.price ? `<span class="num muted" style="font-size:11px;">${fmtRub(k.price)}</span>` : ""}
              </div>
            `).join("")}
          </div>
        </div>
      ` : `<div class="muted" style="font-size:11.5px;margin-bottom:10px;">${esc(t("need_keys_empty"))}</div>`}

      ${prereqs.length ? `
        <div style="margin-bottom:10px;">
          <div class="muted" style="font-size:11px;margin-bottom:4px;">${esc(t("guide_chain_prev"))}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            ${prereqs.map((p) => `<button type="button" class="btn btn-ghost" style="padding:3px 7px;font-size:11px;" onclick="openQuestGuide('${esc(p.id)}')">← ${esc(p.name)}</button>`).join("")}
          </div>
        </div>
      ` : ""}

      ${unlocks.length ? `
        <div>
          <div class="muted" style="font-size:11px;margin-bottom:4px;">${esc(t("guide_chain_next"))}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            ${unlocks.map((u) => `<button type="button" class="btn btn-ghost" style="padding:3px 7px;font-size:11px;" onclick="openQuestGuide('${esc(u.id)}')">→ ${esc(u.name)}</button>`).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;

  const steps = data.wikiSections || [];
  let mainStepBadgeNum = 0;
  const detailTag = state.lang === "en" ? "NOTE" : "ДЕТАЛЬ";
  const stepPrefix = state.lang === "en" ? "STEP" : "ШАГ";
  const stepsHtml = steps.length
    ? `<div class="guide-steps-wrap">${steps.map((sec) => {
        const isSub = (sec.level || 2) >= 3;
        if (!isSub) mainStepBadgeNum += 1;
        const badgeText = isSub ? detailTag : `${stepPrefix} ${String(mainStepBadgeNum).padStart(2, "0")}`;
        const blocksHtml = (sec.blocks || []).map((blk) => {
          if (blk.type === "p") return `<p>${esc(blk.text)}</p>`;
          if (blk.type === "list") return `<ul>${(blk.items || []).map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`;
          if (blk.type === "table" && blk.rows?.length) {
            const [hdr, ...rows] = blk.rows;
            return `
              <div class="guide-table-wrap">
                <table class="guide-table">
                  <thead><tr>${hdr.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
                  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
                </table>
              </div>
            `;
          }
          return "";
        }).join("");
        const imgsHtml = (sec.images || []).length
          ? `<div class="guide-step-gallery">${sec.images.map((im) => {
              const src = mediaSrc(im.url);
              return `
              <div class="guide-thumb-wrap" tabindex="0" role="button" onclick="openScreenshotLightbox('${esc(src)}', '${esc(im.caption || sec.title)}')">
                <img src="${esc(src)}" alt="${esc(im.caption || sec.title)}" loading="eager" referrerpolicy="no-referrer" />
                ${im.caption ? `<div class="guide-thumb-caption">${esc(im.caption)}</div>` : ""}
              </div>
            `;
            }).join("")}</div>`
          : "";
        return `
          <div class="guide-step-card ${isSub ? "substep" : ""}">
            <div class="guide-step-head">
              <span class="guide-step-badge">${badgeText}</span>
              <span class="guide-step-title">${esc(sec.title)}</span>
            </div>
            ${blocksHtml ? `<div class="guide-step-body">${blocksHtml}</div>` : ""}
            ${imgsHtml}
          </div>
        `;
      }).join("")}</div>`
    : `
      <div class="guide-fallback-banner">
        <div>
          <b>${esc(state.lang === "en" ? "Tarkov.Help walkthrough not found" : "Гайд на Tarkov.Help не найден")}</b>
          <div class="muted" style="margin-top:2px;">${esc(t("guide_no_walkthrough"))}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" onclick="openQuestGuide('${esc(data.taskId)}', true)">${esc(t("guide_btn_refresh"))}</button>
          ${extUrl ? `<a href="${esc(extUrl)}" target="_blank" rel="noopener" class="btn btn-primary">${esc(extUrl.includes("tarkov.help") ? t("guide_btn_open_help") : t("guide_btn_open_dev"))}</a>` : ""}
        </div>
      </div>
    `;

  const rewardsHtml = `
    <div class="stack-col" style="gap:12px;">
      ${(rew.items || []).length ? `
        <div>
          <div class="guide-card-title"><span>${esc(t("guide_rewards_items"))}</span></div>
          <div class="guide-rewards-grid">
            ${rew.items.map((it) => `
              <div class="guide-reward-card">
                ${it.iconLink ? `<img class="guide-obj-ico" src="${esc(it.iconLink)}" alt="" referrerpolicy="no-referrer" />` : ""}
                <div style="min-width:0;">
                  <div style="font-size:12.5px;font-weight:600;">${esc(it.name)}</div>
                  <div class="num muted" style="font-size:11px;">×${fmtNum(it.count || 1)}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
      ${(rew.standing || []).length ? `
        <div>
          <div class="guide-card-title"><span>${esc(t("guide_rewards_rep"))}</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${rew.standing.map((s) => `<span class="badge ${s.standing >= 0 ? "green" : "red"}">${esc(s.traderName)}: ${s.standing >= 0 ? "+" : ""}${s.standing}</span>`).join("")}
          </div>
        </div>
      ` : ""}
      ${(rew.offers || []).length ? `
        <div>
          <div class="guide-card-title"><span>${esc(t("guide_rewards_offers"))}</span></div>
          <div class="guide-rewards-grid">
            ${rew.offers.map((o) => `
              <div class="guide-reward-card">
                ${o.iconLink ? `<img class="guide-obj-ico" src="${esc(o.iconLink)}" alt="" referrerpolicy="no-referrer" />` : ""}
                <div style="min-width:0;">
                  <div style="font-size:12.5px;font-weight:600;">${esc(o.itemName)}</div>
                  <div class="muted" style="font-size:11px;">${esc(o.traderName)} • ${esc(t("th_lvl"))} ${o.level}</div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
      ${(rew.crafts || []).length ? `
        <div>
          <div class="guide-card-title"><span>${esc(t("guide_rewards_crafts"))}</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${rew.crafts.map((c) => `<span class="badge">${esc(c.station)} LL${c.level}: ${esc((c.items || []).join(", "))}</span>`).join("")}
          </div>
        </div>
      ` : ""}
      ${!rewCount ? `<div class="muted" style="font-size:12px;">${esc(t("guide_rewards_empty"))}</div>` : ""}
    </div>
  `;

  const galleryHtml = wikiImgs.length
    ? `<div class="guide-images-grid">${wikiImgs.map((im) => {
        const src = mediaSrc(im.url);
        return `
        <div class="guide-thumb-wrap" tabindex="0" role="button" onclick="openScreenshotLightbox('${esc(src)}', '${esc(im.caption || finalTitle)}')">
          <img src="${esc(src)}" alt="${esc(im.caption || finalTitle)}" loading="eager" referrerpolicy="no-referrer" />
          ${im.caption ? `<div class="guide-thumb-caption">${esc(im.caption)}</div>` : ""}
        </div>
      `;
      }).join("")}</div>`
    : `<div class="muted" style="font-size:12px;">${esc(t("guide_gallery_empty"))}</div>`;

  const sub = currentGuideState.subtab || "steps";
  bodyEl.innerHTML = `
    <div class="guide-kpi-strip">
      <div class="guide-kpi-cell">
        <div class="guide-kpi-lbl">${esc(t("th_map"))}</div>
        <div class="guide-kpi-val">${esc(br.mapName || t("any_map"))}</div>
      </div>
      <div class="guide-kpi-cell">
        <div class="guide-kpi-lbl">${esc(t("th_lvl"))}</div>
        <div class="guide-kpi-val num">${esc(t("guide_req_lvl", { lvl: br.minPlayerLevel || 1 }))}</div>
      </div>
      <div class="guide-kpi-cell">
        <div class="guide-kpi-lbl">${esc(t("guide_rewards_xp"))}</div>
        <div class="guide-kpi-val num">+${fmtNum(br.experience || 0)} XP</div>
      </div>
      <div class="guide-kpi-cell">
        <div class="guide-kpi-lbl">${esc(t("guide_chain_title"))}</div>
        <div class="guide-kpi-val num">${prereqs.length} ← • → ${unlocks.length}</div>
      </div>
    </div>

    <div class="guide-tabs-bar">
      <div class="subtabs compact" id="guideModalSubtabs">
        <button type="button" class="subtab-btn ${sub === "steps" ? "active" : ""}" data-guide-tab="steps">${esc(t("guide_tab_walkthrough"))}</button>
        <button type="button" class="subtab-btn ${sub === "rewards" ? "active" : ""}" data-guide-tab="rewards">${esc(t("guide_tab_rewards"))} (${rewCount})</button>
        ${wikiImgs.length ? `<button type="button" class="subtab-btn ${sub === "gallery" ? "active" : ""}" data-guide-tab="gallery">${esc(t("guide_tab_gallery"))} (${wikiImgs.length})</button>` : ""}
      </div>
    </div>

    <div class="subtab-reveal" id="guideTabPanelSteps" style="display:${sub === "steps" ? "flex" : "none"};flex-direction:column;gap:12px;">
      <div class="guide-briefing-grid">
        <div class="guide-card">
          <div class="guide-card-title"><span>${esc(t("guide_objectives_title"))}</span><span class="num">${objs.length}</span></div>
          ${objectivesHtml}
        </div>
        ${metaSideHtml}
      </div>
      <div>
        <div class="guide-card-title" style="margin-bottom:8px;"><span>${esc(t("guide_walkthrough_title"))}</span></div>
        ${stepsHtml}
      </div>
    </div>

    <div class="subtab-reveal" id="guideTabPanelRewards" style="display:${sub === "rewards" ? "block" : "none"};">
      ${rewardsHtml}
    </div>

    <div class="subtab-reveal" id="guideTabPanelGallery" style="display:${sub === "gallery" ? "block" : "none"};">
      ${galleryHtml}
    </div>
  `;

  document.getElementById("guideModalSubtabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-guide-tab]");
    if (!btn) return;
    currentGuideState.subtab = btn.dataset.guideTab;
    renderQuestGuideModal(currentGuideState.data);
  });
}

window.setGuideTaskStatus = async (taskId, status) => {
  await api("/api/quests/status", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, taskId, status }),
  });
  invalidateDataCache(false);
  await loadQuests(true);
  if (currentGuideState.data && currentGuideState.taskId === taskId) {
    renderQuestGuideModal(currentGuideState.data);
  }
  showToast(t("toast_status_updated"));
};

window.closeQuestGuide = () => {
  closeAnimatedModal(document.getElementById("questGuideModal"));
};

document.getElementById("btnCloseGuideModal")?.addEventListener("click", closeQuestGuide);
document.getElementById("btnCloseGuideModalBottom")?.addEventListener("click", closeQuestGuide);
document.getElementById("questGuideModal")?.addEventListener("click", (e) => {
  if (e.target.id === "questGuideModal") closeQuestGuide();
});

window.openScreenshotLightbox = (src, alt) => {
  const box = document.getElementById("screenshotLightbox");
  const img = document.getElementById("lightboxImg");
  const cap = document.getElementById("lightboxCaption");
  if (!box || !img) return;
  img.setAttribute("referrerpolicy", "no-referrer");
  img.src = src;
  if (cap) cap.textContent = alt ? t("lightbox_caption_named", { alt }) : t("lightbox_caption");
  openAnimatedModal(box);
};

window.closeScreenshotLightbox = () => {
  closeAnimatedModal(document.getElementById("screenshotLightbox"));
};

document.getElementById("screenshotLightbox")?.addEventListener("click", closeScreenshotLightbox);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const lightbox = document.getElementById("screenshotLightbox");
    if (lightbox?.dataset.open === "true") {
      closeScreenshotLightbox();
      return;
    }
    const guide = document.getElementById("questGuideModal");
    if (guide?.dataset.open === "true") {
      closeQuestGuide();
      return;
    }
    const settings = document.getElementById("settingsModal");
    if (settings?.dataset.open === "true") {
      closeAnimatedModal(settings);
      return;
    }
    const mapPop = document.getElementById("mapPinPopover");
    if (mapPop?.dataset.open === "true") {
      closeMapPinPopover();
    }
  }
});

// Pan & Zoom on Map Viewport (rAF-coalesced hardware translate3d)
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

// --- TAB 3: CULTIST CIRCLE ---
document.getElementById("btnSolveCultist").addEventListener("click", () => loadCultist(true));
async function loadCultist(force = false) {
  const btn = document.getElementById("btnSolveCultist");
  const host = document.getElementById("cultistSolutions");
  const target = document.getElementById("cultistTarget").value;
  const slots = document.getElementById("cultistSlots").value;
  const traders = document.getElementById("cultistTraders").checked ? "1" : "0";
  const sig = `${state.mode}:${state.lang}:${state.dataRev}:${target}:${slots}:${traders}`;
  if (!force && renderCache.cultistSig === sig) return;

  GlyphLoader.buttonBusy(btn, t("cultist_btn_busy"));
  if (host) host.innerHTML = GlyphLoader.panelShader(t("cultist_loader_title"), t("cultist_loader_sub"));
  try {
    const data = await api(`/api/cultist/solve?mode=${state.mode}&target=${target}&slots=${slots}&traders=${traders}`);
    renderCache.cultistSig = sig;
    const slotUnit = state.lang === "en" ? "slots" : "сл.";
    const effLbl = state.lang === "en" ? "ratio" : "коэфф.";
    const costLbl = t("cultist_cost");
    host.innerHTML = data.solutions.length
      ? data.solutions.map((sol, idx) => `
          <div class="solution-card">
            <div class="card-header" style="margin-bottom:8px;">
              <div>
                <b>${esc(t("cultist_variant", { idx: idx + 1 }))}</b> • <span class="num">${sol.slotsUsed} ${slotUnit}</span>
                <div class="muted">Base Value: <b class="num">${fmtRub(sol.totalBaseValue)}</b> (${effLbl} ${sol.efficiency}×)</div>
              </div>
              <span class="badge green num">${esc(costLbl)} ${fmtRub(sol.totalCost)}</span>
            </div>
            <div class="mini-list">
              ${sol.items.map((it) => `
                <div class="list-row">
                  <div><b>${it.qty}× ${esc(it.name)}</b> <span class="muted">(${esc(it.source)})</span></div>
                  <div class="num muted">${fmtRub(it.cost)} / Base ${fmtRub(it.basePrice)}</div>
                </div>
              `).join("")}
            </div>
          </div>
        `).join("")
      : `<div class="muted">${esc(t("cultist_no_sol"))}</div>`;
    state.cultistTimers = data.timers || [];
    renderCultistTimers(state.cultistTimers);
  } finally {
    GlyphLoader.buttonDone(btn);
  }
}

document.querySelectorAll("[data-timer-hours]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const hours = Number(btn.dataset.timerHours);
    const note = hours === 6
      ? (state.lang === "en" ? "Quest / Hideout chance" : "Шанс квест/Убежище")
      : (state.lang === "en" ? "Rare loot pool" : "Редкий лут");
    const res = await api("/api/cultist/timer", { method: "POST", body: JSON.stringify({ mode: state.mode, hours, note }) });
    state.cultistTimers = res.timers || [];
    renderCultistTimers(state.cultistTimers);
    showToast(state.lang === "en" ? `Cultist Circle ${hours}h timer started` : `Таймер Круга Сектантов на ${hours}ч запущен`);
  });
});

function renderCultistTimers(timers) {
  const host = document.getElementById("cultistTimers");
  if (!timers.length) {
    host.innerHTML = `<div class="muted">${esc(t("cultist_timers_empty"))}</div>`;
    return;
  }
  const now = Date.now();
  const hrUnit = state.lang === "en" ? "h" : "ч";
  const defNote = state.lang === "en" ? "Ritual" : "Ритуал";
  const remPrefix = state.lang === "en" ? "Remaining" : "Осталось";
  host.innerHTML = timers.map((t) => {
    const diff = Math.max(0, Math.floor((Date.parse(t.ends_at) - now) / 1000));
    const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
    const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const ss = String(diff % 60).padStart(2, "0");
    return `
      <div class="list-row">
        <div><b>${t.duration_hours}${hrUnit} • ${esc(t.note || defNote)}</b><div class="muted">${diff === 0 ? esc(window.t("cultist_timer_done")) : `${remPrefix} ${hh}:${mm}:${ss}`}</div></div>
        <button class="btn btn-ghost" onclick="deleteCultistTimer(${t.id})">✕</button>
      </div>
    `;
  }).join("");
}
window.deleteCultistTimer = async (id) => {
  await api(`/api/cultist/timer/${id}`, { method: "DELETE" });
  loadCultist();
};

setupAutocomplete("cultistItemSearch", "cultistItemDropdown", async (item) => {
  const totalSlots = state.cultistBasket.reduce((s, x) => s + x.qty, 0);
  if (totalSlots >= 5) return showToast(state.lang === "en" ? "Maximum 5 items in Cultist Circle" : "Максимум 5 предметов в Круге Сектантов");
  const ex = state.cultistBasket.find((x) => x.id === item.id);
  if (ex) ex.qty += 1;
  else state.cultistBasket.push({ id: item.id, name: item.name, qty: 1 });
  evaluateCultistBasket();
});

async function evaluateCultistBasket() {
  const traders = document.getElementById("cultistTraders").checked;
  const res = await api("/api/cultist/evaluate", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, allowTraders: traders, items: state.cultistBasket }),
  });
  document.getElementById("cultistBasket").innerHTML = res.items.map((it, idx) => `
    <div class="list-row">
      <div><b>${it.qty}× ${esc(it.name)}</b> <span class="muted">(Base ${fmtRub(it.unitBase)})</span></div>
      <button class="btn btn-ghost" onclick="removeBasketItem(${idx})">✕</button>
    </div>
  `).join("") || `<div class="muted">${esc(t("cultist_basket_empty"))}</div>`;

  const slotsLbl = state.lang === "en" ? "Slots:" : "Слотов:";
  const forecastLbl = state.lang === "en" ? "Tier forecast:" : "Прогноз:";
  document.getElementById("cultistBasketResult").innerHTML = `
    <div>${slotsLbl} <b>${res.slotsUsed} / 5</b> • Base Value: <b class="num">${fmtRub(res.totalBaseValue)}</b> • ${esc(t("cultist_cost"))} <b class="num">${fmtRub(res.totalCost)}</b></div>
    <div class="muted" style="margin-top:4px;">${forecastLbl} <b>${esc(res.tier)}</b></div>
  `;
}
window.removeBasketItem = (idx) => { state.cultistBasket.splice(idx, 1); evaluateCultistBasket(); };

// --- TAB 4: ITEM COUNTER ---
const getCounterCategoryLabel = (tag) => {
  const map = {
    quest: [t("items_cat_quest"), "amber"],
    hideout: [t("items_cat_hideout"), ""],
    barter: [t("items_cat_barter"), ""],
    keys: [t("items_cat_keys"), "green"],
    general: [t("items_cat_general"), ""],
  };
  return map[tag] || [t("items_cat_general"), ""];
};

setupAutocomplete("counterItemSearch", "counterItemDropdown", (item) => {
  state.selectedCounterItem = item;
  document.getElementById("counterItemSearch").value = item.name;
});

document.getElementById("counterItemSearch")?.addEventListener("input", (e) => {
  const val = e.target.value.trim();
  if (state.selectedCounterItem && state.selectedCounterItem.name !== val) {
    state.selectedCounterItem = null;
  }
});

document.querySelectorAll("[data-qty-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = Number(btn.dataset.qtyPreset || 1);
    const inp = document.getElementById("counterTargetQty");
    if (inp) inp.value = String(val);
    document.querySelectorAll("[data-qty-preset]").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

async function addTrackedItemFromForm() {
  const inpName = document.getElementById("counterItemSearch");
  const inpCur = document.getElementById("counterCurrentQty");
  const inpTgt = document.getElementById("counterTargetQty");
  const selCat = document.getElementById("counterCategoryTag");
  const chkFir = document.getElementById("counterFirOnly");
  const inpNote = document.getElementById("counterItemNote");

  const name = (inpName?.value || "").trim();
  if (!name) return showToast(t("items_toast_empty_name"));
  const targetQty = Math.max(1, Math.round(Number(inpTgt?.value || 1)));
  const currentQty = Math.max(0, Math.round(Number(inpCur?.value || 0)));
  const catalogMatch = state.selectedCounterItem && state.selectedCounterItem.name === name
    ? state.selectedCounterItem
    : null;

  const res = await api("/api/item-counter", {
    method: "POST",
    body: JSON.stringify({
      mode: state.mode,
      lang: state.lang,
      itemId: catalogMatch?.id || "",
      name,
      shortName: catalogMatch?.shortName || "",
      iconLink: catalogMatch?.iconLink || "",
      currentQty,
      targetQty,
      categoryTag: selCat?.value || "general",
      firOnly: Boolean(chkFir?.checked),
      notes: (inpNote?.value || "").trim(),
    }),
  });
  state.counterItems = res.items || [];
  state.counterKpis = res.summary || null;
  renderCache.itemsSig = `${state.mode}:${state.lang}:${state.dataRev}`;

  if (inpName) inpName.value = "";
  if (inpCur) inpCur.value = "0";
  if (inpTgt) inpTgt.value = "1";
  if (inpNote) inpNote.value = "";
  document.getElementById("counterItemDropdown")?.classList.remove("open");
  setCheckboxAtRest(chkFir, false);
  state.selectedCounterItem = null;
  document.querySelectorAll("[data-qty-preset]").forEach((b) => b.classList.remove("active"));

  renderItemCounter();
  showToast(t("items_toast_added", { name: `${name} (${currentQty}/${targetQty})` }));
}

document.getElementById("btnAddTrackedItem")?.addEventListener("click", addTrackedItemFromForm);
document.getElementById("counterItemSearch")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !document.getElementById("counterItemDropdown")?.classList.contains("open")) {
    e.preventDefault();
    addTrackedItemFromForm();
  }
});
document.getElementById("counterTargetQty")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addTrackedItemFromForm();
  }
});

document.getElementById("btnImportQuestItems")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnImportQuestItems");
  GlyphLoader.buttonBusy(btn, t("btn_import_busy"));
  try {
    const res = await api("/api/item-counter/import-quests", {
      method: "POST",
      body: JSON.stringify({ mode: state.mode, lang: state.lang }),
    });
    state.counterItems = res.items || [];
    state.counterKpis = res.summary || null;
    renderCache.itemsSig = `${state.mode}:${state.lang}:${state.dataRev}`;
    renderItemCounter();
    showToast(t("items_toast_imported", { n: res.imported || 0 }));
  } finally {
    GlyphLoader.buttonDone(btn);
  }
});

document.getElementById("btnClearCompletedItems")?.addEventListener("click", async () => {
  const res = await api("/api/item-counter/clear-completed", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, lang: state.lang }),
  });
  state.counterItems = res.items || [];
  state.counterKpis = res.summary || null;
  renderCache.itemsSig = `${state.mode}:${state.lang}:${state.dataRev}`;
  renderItemCounter();
  showToast(t("items_toast_cleared", { n: res.removed || 0 }));
});

document.getElementById("counterFilterInput")?.addEventListener("input", (e) => {
  state.counterSearchQuery = (e.target.value || "").trim().toLowerCase();
  renderItemCounterList();
});
document.getElementById("counterFilterCategory")?.addEventListener("change", (e) => {
  state.counterCategoryFilter = e.target.value || "all";
  renderItemCounterList();
});
document.getElementById("counterStatusTabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-counter-status]");
  if (!btn) return;
  state.counterStatusFilter = btn.dataset.counterStatus || "all";
  document.querySelectorAll("#counterStatusTabs .subtab-btn").forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
  renderItemCounterList();
});

function recomputeLocalCounterSummary() {
  const items = state.counterItems || [];
  let completedItems = 0;
  let totalUnitsCurrent = 0;
  let totalUnitsTarget = 0;
  items.forEach((it) => {
    const tgt = Math.max(1, Number(it.targetQty || 1));
    const cur = Math.max(0, Number(it.currentQty || 0));
    it.done = cur >= tgt;
    if (it.done) completedItems += 1;
    totalUnitsCurrent += Math.min(cur, tgt);
    totalUnitsTarget += tgt;
  });
  state.counterKpis = {
    totalItems: items.length,
    completedItems,
    activeItems: items.length - completedItems,
    totalUnitsCurrent,
    totalUnitsTarget,
    pctComplete: totalUnitsTarget > 0 ? Math.round((totalUnitsCurrent / totalUnitsTarget) * 100) : 0,
  };
}

async function patchCounterItem(id, payload) {
  const res = await api("/api/item-counter/adjust", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, lang: state.lang, id, ...payload }),
  });
  state.counterItems = res.items || [];
  state.counterKpis = res.summary || null;
  renderCache.itemsSig = `${state.mode}:${state.lang}:${state.dataRev}`;
  renderItemCounter();
}

const counterListHost = document.getElementById("itemCounterList");
counterListHost?.addEventListener("click", async (e) => {
  const stepBtn = e.target.closest("[data-counter-delta]");
  if (stepBtn) {
    const id = Number(stepBtn.dataset.id);
    const delta = Number(stepBtn.dataset.counterDelta);
    const item = state.counterItems.find((x) => x.id === id);
    if (item) {
      item.currentQty = Math.max(0, item.currentQty + delta);
      recomputeLocalCounterSummary();
      renderItemCounter();
    }
    await patchCounterItem(id, { delta });
    return;
  }

  const maxBtn = e.target.closest("[data-counter-max]");
  if (maxBtn) {
    const id = Number(maxBtn.dataset.id);
    const item = state.counterItems.find((x) => x.id === id);
    if (!item) return;
    const nextQty = item.currentQty >= item.targetQty ? 0 : item.targetQty;
    item.currentQty = nextQty;
    recomputeLocalCounterSummary();
    renderItemCounter();
    await patchCounterItem(id, { currentQty: nextQty });
    return;
  }

  const delBtn = e.target.closest("[data-counter-delete]");
  if (delBtn) {
    const id = Number(delBtn.dataset.id);
    const res = await api(`/api/item-counter/${id}?mode=${state.mode}`, { method: "DELETE" });
    state.counterItems = res.items || [];
    state.counterKpis = res.summary || null;
    renderCache.itemsSig = `${state.mode}:${state.lang}:${state.dataRev}`;
    renderItemCounter();
    showToast(state.lang === "en" ? "Item removed" : "Позиция удалена");
  }
});

counterListHost?.addEventListener("change", async (e) => {
  const curInp = e.target.closest(".counter-qty-input");
  if (curInp) {
    const id = Number(curInp.dataset.id);
    const currentQty = Math.max(0, Math.round(Number(curInp.value || 0)));
    await patchCounterItem(id, { currentQty });
    return;
  }
  const tgtInp = e.target.closest(".counter-target-input");
  if (tgtInp) {
    const id = Number(tgtInp.dataset.id);
    const targetQty = Math.max(1, Math.round(Number(tgtInp.value || 1)));
    await patchCounterItem(id, { targetQty });
  }
});

async function loadItemCounter(force = false) {
  const sig = `${state.mode}:${state.lang}:${state.dataRev}`;
  if (!force && renderCache.itemsSig === sig && state.counterKpis) {
    renderItemCounter();
    return;
  }
  const kpisEl = document.getElementById("itemCounterKpis");
  const listEl = document.getElementById("itemCounterList");
  if (kpisEl && !kpisEl.children.length) {
    kpisEl.innerHTML = GlyphLoader.kpiCells(4, [
      t("items_kpi_total"), t("items_kpi_done"), t("items_kpi_units"), t("items_kpi_pct"),
    ]);
  }
  if (listEl && !listEl.children.length) {
    listEl.innerHTML = GlyphLoader.inline(state.lang === "en" ? "Loading item counter..." : "Загрузка счётчика предметов...");
  }
  const data = await api(`/api/item-counter?mode=${state.mode}`);
  state.counterItems = data.items || [];
  state.counterKpis = data.summary || null;
  renderCache.itemsSig = sig;
  renderItemCounter();
}

function renderItemCounter() {
  const s = state.counterKpis || {
    totalItems: 0,
    completedItems: 0,
    activeItems: 0,
    totalUnitsCurrent: 0,
    totalUnitsTarget: 0,
    pctComplete: 0,
  };
  const kpisEl = document.getElementById("itemCounterKpis");
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div class="telemetry-cell">
        <div class="telemetry-label">${esc(t("items_kpi_total"))}</div>
        <div class="telemetry-row">
          <div class="telemetry-value">${s.totalItems}</div>
          <div class="telemetry-delta">${esc(t("items_kpi_left"))}: ${s.activeItems}</div>
        </div>
      </div>
      <div class="telemetry-cell">
        <div class="telemetry-label">${esc(t("items_kpi_done"))}</div>
        <div class="telemetry-row">
          <div class="telemetry-value">${s.completedItems}</div>
          <div class="telemetry-delta">/ ${s.totalItems}</div>
        </div>
      </div>
      <div class="telemetry-cell">
        <div class="telemetry-label">${esc(t("items_kpi_units"))}</div>
        <div class="telemetry-row">
          <div class="telemetry-value accent">${s.totalUnitsCurrent} <span class="muted" style="font-size:15px;">/ ${s.totalUnitsTarget}</span></div>
        </div>
      </div>
      <div class="telemetry-cell">
        <div class="telemetry-label">${esc(t("items_kpi_pct"))}</div>
        <div class="telemetry-row">
          <div class="telemetry-value accent">${s.pctComplete}%</div>
        </div>
        <div class="kpi-bar"><div class="kpi-bar-fill" style="width:${Math.min(100, s.pctComplete)}%"></div></div>
      </div>
    `;
  }
  renderItemCounterList();
}

function renderItemCounterList() {
  const host = document.getElementById("itemCounterList");
  const meta = document.getElementById("counterCountMeta");
  if (!host) return;

  const q = state.counterSearchQuery;
  const cat = state.counterCategoryFilter;
  const st = state.counterStatusFilter;

  const filtered = (state.counterItems || []).filter((it) => {
    if (cat !== "all" && it.categoryTag !== cat) return false;
    if (st === "active" && it.done) return false;
    if (st === "done" && !it.done) return false;
    if (q && !(it.name || "").toLowerCase().includes(q) && !(it.shortName || "").toLowerCase().includes(q) && !(it.notes || "").toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  if (meta) {
    meta.textContent = state.lang === "en"
      ? `${filtered.length} of ${(state.counterItems || []).length}`
      : `${filtered.length} из ${(state.counterItems || []).length}`;
  }

  if (!filtered.length) {
    host.innerHTML = `<div class="panel-section" style="grid-column:1 / -1;"><div class="muted">${(state.counterItems || []).length ? esc(t("items_empty_filter")) : esc(t("items_empty"))}</div></div>`;
    return;
  }

  host.innerHTML = filtered.map((it) => {
    const cur = Math.max(0, Number(it.currentQty || 0));
    const tgt = Math.max(1, Number(it.targetQty || 1));
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    const [catLabel, catCls] = getCounterCategoryLabel(it.categoryTag);
    const abbr = esc((it.shortName || it.name || "?").slice(0, 4).toUpperCase());
    const thumbHtml = it.iconLink
      ? `<img src="${esc(it.iconLink)}" alt="" loading="lazy" />`
      : `<span>${abbr}</span>`;
    return `
      <article class="counter-card ${it.done ? "is-done" : ""}">
        <div class="counter-card-head">
          <div class="counter-item-thumb">${thumbHtml}</div>
          <div class="counter-card-info">
            <div class="counter-card-title">${esc(it.name)}</div>
            <div class="counter-card-badges">
              <span class="badge ${catCls}">${esc(catLabel)}</span>
              ${it.firOnly ? `<span class="badge amber">FIR</span>` : ""}
              ${it.done ? `<span class="badge green">${esc(t("items_st_done"))}</span>` : ""}
            </div>
            ${it.notes ? `<div class="counter-card-note">${esc(it.notes)}</div>` : ""}
          </div>
          <button type="button" class="btn btn-ghost" data-counter-delete="1" data-id="${it.id}" title="${esc(t("items_btn_del"))}" style="padding:2px 6px;">✕</button>
        </div>

        <div class="counter-progress-row">
          <div class="counter-progress-track">
            <div class="counter-progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="counter-ratio-label">${cur} / ${tgt} (${pct}%)</span>
        </div>

        <div class="counter-controls">
          <button type="button" class="counter-step-btn" data-counter-delta="-5" data-id="${it.id}">−5</button>
          <button type="button" class="counter-step-btn" data-counter-delta="-1" data-id="${it.id}">−1</button>
          <div class="counter-direct-pair">
            <input type="number" class="counter-num-input counter-qty-input" data-id="${it.id}" min="0" value="${cur}" aria-label="${esc(t("items_cur_lbl"))}" />
            <span class="muted">/</span>
            <input type="number" class="counter-num-input counter-target-input" data-id="${it.id}" min="1" value="${tgt}" aria-label="${esc(t("items_tgt_lbl"))}" />
          </div>
          <button type="button" class="counter-step-btn plus" data-counter-delta="1" data-id="${it.id}">+1</button>
          <button type="button" class="counter-step-btn plus" data-counter-delta="5" data-id="${it.id}">+5</button>
          <button type="button" class="counter-step-btn done-btn" data-counter-max="1" data-id="${it.id}">${it.done ? "↺ 0" : `✓ ${esc(t("items_st_all"))}`}</button>
        </div>
      </article>
    `;
  }).join("");
}

// --- Autocomplete Helper ---
function setupAutocomplete(inputId, dropdownId, onSelect) {
  const inp = document.getElementById(inputId);
  const dd = document.getElementById(dropdownId);
  let timer = null;
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (q.length < 2) { dd.classList.remove("open"); return; }
    timer = setTimeout(async () => {
      const res = await api(`/api/items/search?mode=${state.mode}&q=${encodeURIComponent(q)}`);
      if (inp.value.trim() !== q) {
        dd.classList.remove("open");
        return;
      }
      dd._items = res.items || [];
      dd.innerHTML = dd._items.map((it, i) => `
        <div class="dropdown-item" data-idx="${i}">
          <span>${it.name}</span>
          <span class="num muted">${fmtRub(it.stashUnitRub || it.basePrice)}</span>
        </div>
      `).join("");
      dd.classList.toggle("open", dd._items.length > 0);
    }, 180);
  });
  dd.addEventListener("click", (e) => {
    const row = e.target.closest(".dropdown-item");
    if (!row) return;
    const item = dd._items[Number(row.dataset.idx)];
    dd.classList.remove("open");
    if (item) onSelect(item);
  });
}

// --- Animate UI Checkboxes ---
function initAnimatedCheckboxes(root = document) {
  if (!root) return;
  const inputs = root.querySelectorAll('input[type="checkbox"]');
  const created = [];
  inputs.forEach((input) => {
    if (input.closest(".ui-checkbox")) return;
    const wrap = document.createElement("span");
    const isMapTask = input.classList.contains("map-task-checkbox");
    wrap.className = "ui-checkbox" + (isMapTask ? " ui-checkbox-compact ui-checkbox-purple" : "");
    wrap.dataset.ready = "false";

    const parent = input.parentNode;
    if (!parent) return;
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    const fill = document.createElement("span");
    fill.className = "ui-checkbox-fill";
    fill.setAttribute("aria-hidden", "true");
    wrap.appendChild(fill);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ui-checkbox-tick");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2.2 6.3L4.9 9L9.8 3.2");
    svg.appendChild(path);
    wrap.appendChild(svg);

    created.push(wrap);
  });

  if (created.length) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        created.forEach((w) => {
          w.dataset.ready = "true";
        });
      });
    });
  }
}

function setCheckboxAtRest(input, checked) {
  if (!input) return;
  const wrap = input.closest(".ui-checkbox");
  if (wrap) wrap.dataset.ready = "false";
  input.checked = Boolean(checked);
  if (wrap) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.dataset.ready = "true";
      });
    });
  }
}

// --- Settings Modal ---
const modal = document.getElementById("settingsModal");
document.getElementById("btnSettings").addEventListener("click", () => {
  const c = state.bootstrap?.config || {};
  const langSel = document.getElementById("cfgLanguage");
  if (langSel) langSel.value = state.lang;
  setCheckboxAtRest(document.getElementById("cfgWatchLogs"), Boolean(c.watch_logs));
  setCheckboxAtRest(document.getElementById("cfgWatchScreens"), Boolean(c.watch_screenshots));
  document.getElementById("cfgLogsDir").value = c.eft_logs_dir || "";
  document.getElementById("cfgScreensDir").value = c.eft_screenshots_dir || "";
  openAnimatedModal(modal, "#btnCloseSettings");
});
["btnCloseSettings", "btnCancelSettings"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => closeAnimatedModal(modal));
});
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeAnimatedModal(modal);
});
document.getElementById("btnSaveSettings").addEventListener("click", async () => {
  const nextLang = document.getElementById("cfgLanguage")?.value || state.lang;
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({
      language: nextLang,
      watch_logs: document.getElementById("cfgWatchLogs").checked,
      watch_screenshots: document.getElementById("cfgWatchScreens").checked,
      eft_logs_dir: document.getElementById("cfgLogsDir").value.trim(),
      eft_screenshots_dir: document.getElementById("cfgScreensDir").value.trim(),
    }),
  });
  closeAnimatedModal(modal);
  if (nextLang !== state.lang) {
    await setAppLanguage(nextLang, false);
  } else {
    showToast(t("toast_settings_saved"));
    loadBootstrap();
  }
});

// Engine Boot & Prerender Sequence
function setBootStage(pct, text) {
  const fill = document.getElementById("bootProgressFill");
  const pctEl = document.getElementById("bootPct");
  const txtEl = document.getElementById("bootStatusText");
  if (fill) fill.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (txtEl && text) txtEl.textContent = text;
}

function dismissBootOverlay() {
  const el = document.getElementById("engineBootOverlay");
  if (!el) return;
  el.dataset.open = "false";
  el.setAttribute("aria-hidden", "true");
}

ThemeManager.loadSaved();
(async function init() {
  const savedLang = localStorage.getItem("eft_assistant_lang");
  if (savedLang === "en" || savedLang === "ru") {
    state.lang = savedLang;
  }
  document.querySelectorAll("#langSwitch .mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === state.lang);
  });
  window.applyI18nToDom?.();
  ThemeManager.bindUi();
  ThemeManager.refreshLabels();
  initAnimatedCheckboxes(document);
  initAsciiShaderBackground();
  GlyphLoader.kick();

  const yieldFrame = () => new Promise((r) => requestAnimationFrame(r));

  try {
    setBootStage(15, `[1/4] ${t("boot_bootstrap")}`);
    const savedMode = localStorage.getItem("eft_assistant_mode");
    if (savedMode === "pve" || savedMode === "regular") {
      state.mode = savedMode;
    }
    await loadBootstrap();
    if (!savedLang && (state.bootstrap?.config?.language === "en" || state.bootstrap?.config?.language === "ru")) {
      state.lang = state.bootstrap.config.language;
      document.querySelectorAll("#langSwitch .mode-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.lang === state.lang);
      });
      window.applyI18nToDom?.();
      ThemeManager.refreshLabels();
    }
    if (!savedMode && state.bootstrap?.watcher?.detectedMode) {
      state.mode = state.bootstrap.watcher.detectedMode;
    } else if (!savedMode && state.bootstrap?.config?.default_game_mode) {
      state.mode = state.bootstrap.config.default_game_mode;
    }
    document.querySelectorAll("#modeSwitch .mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === state.mode);
    });
    requestAnimationFrame(syncAllIndicators);
    state.cultistTimers = state.bootstrap?.cultistTimers || [];

    setBootStage(45, `[2/4] ${t("boot_quests")}`);
    await ensureQuestsData(true);

    setBootStage(75, `[3/4] ${t("tree_title")}...`);
    await yieldFrame();
    populateTreeTraderSelect(state.quests);
    renderQuestTree();
    renderCache.treeSig = `${state.mode}:${state.lang}:${state.dataRev}`;

    setBootStage(94, `[4/4] ${t("quests_title")}...`);
    await yieldFrame();
    renderQuestsFromState();

    const mapSig = `${state.mode}:${state.lang}:${state.currentMapNorm}:${state.dataRev}`;
    const itemsSig = `${state.mode}:${state.lang}:${state.dataRev}`;
    Promise.allSettled([
      api(`/api/maps/${state.currentMapNorm}?mode=${state.mode}`).then((d) => renderCache.mapsDataByKey.set(mapSig, d)),
      api(`/api/item-counter?mode=${state.mode}`).then((d) => {
        state.counterItems = d.items || [];
        state.counterKpis = d.summary || null;
        renderCache.itemsSig = itemsSig;
      }),
    ]);

    setBootStage(100, t("boot_ready"));
    await new Promise((r) => setTimeout(r, 120));
  } finally {
    dismissBootOverlay();
  }

  setInterval(() => {
    if (state.activeTab === "cultist" && state.cultistTimers.length) {
      renderCultistTimers(state.cultistTimers);
    }
  }, 1000);
  setInterval(() => {
    if (!document.hidden) loadBootstrap();
  }, 15000);
})();
