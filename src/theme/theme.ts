export interface ThemeConfig {
  base: string;
  accent: string;
  uiStyle: string;
  shaderMode: string;
  glowMode: string;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface StyleOption {
  id: string;
  name: { ru: string; en: string };
  desc: { ru: string; en: string };
}

export interface ThemePreset {
  id: string;
  name: string;
  base: string;
  accent: string;
}

export const THEME_STORAGE_KEY = "eft_assistant_theme_v1";

export const DEFAULT_THEME: ThemeConfig = {
  base: "#0c0d0f",
  accent: "#d99b26",
  uiStyle: "tactical",
  shaderMode: "topo",
  glowMode: "standard",
};

export const UI_STYLES: StyleOption[] = [
  { id: "tactical", name: { ru: "Тактический", en: "Tactical" }, desc: { ru: "Чёткие грани 5px", en: "Sharp 5px edges" } },
  { id: "glass", name: { ru: "Стеклянный HUD", en: "Glass HUD" }, desc: { ru: "Полупрозрачный blur", en: "Translucent blur" } },
  { id: "brutalist", name: { ru: "Брутализм", en: "Brutalist" }, desc: { ru: "Углы 0px и тени", en: "0px corners & shadows" } },
  { id: "soft", name: { ru: "Мягкий", en: "Soft" }, desc: { ru: "Округлый 10–14px", en: "Rounded 10–14px" } },
  { id: "cyber", name: { ru: "Кибер-дек", en: "Cyberdeck" }, desc: { ru: "Моно и акцент-рамки", en: "Mono & accent frames" } },
];

export const SHADER_MODES: StyleOption[] = [
  { id: "topo", name: { ru: "Топография", en: "Topography" }, desc: { ru: "Изогипсы и пульс", en: "Contours & pulse" } },
  { id: "matrix", name: { ru: "Поток данных", en: "Data Stream" }, desc: { ru: "Волна символов", en: "Glyph wave" } },
  { id: "radar", name: { ru: "Радар-сетка", en: "Radar Grid" }, desc: { ru: "Скан-фронт слева", en: "Left-to-right scan" } },
  { id: "minimal", name: { ru: "Минимализм", en: "Minimal" }, desc: { ru: "Спокойные точки", en: "Subtle dots" } },
  { id: "off", name: { ru: "Отключён", en: "Disabled" }, desc: { ru: "Чистый статичный фон", en: "Clean static canvas" } },
];

export const GLOW_MODES: StyleOption[] = [
  { id: "standard", name: { ru: "Стандарт", en: "Standard" }, desc: { ru: "Умеренный контраст", en: "Balanced contrast" } },
  { id: "neon", name: { ru: "Неоновый контур", en: "Neon Rim" }, desc: { ru: "Акцентное свечение", en: "Accent glow" } },
  { id: "minimal", name: { ru: "Строгий матовый", en: "Matte" }, desc: { ru: "Без теней и бликов", en: "No shadows or glow" } },
];

export const THEME_PRESETS: ThemePreset[] = [
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

export function normalizeHex(raw: string | undefined, fallback: string): string {
  const m = String(raw || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

export function hexToRgb(hex: string): Rgb {
  const clean = normalizeHex(hex, "#000000").slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export function relLuminance({ r, g, b }: Rgb): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(rgbA: Rgb, rgbB: Rgb): number {
  const la = relLuminance(rgbA);
  const lb = relLuminance(rgbB);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbaStr(rgb: Rgb, a: number): string {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
}

function normalizeOpt(val: string | undefined, list: StyleOption[], fallback: string): string {
  return list.some((x) => x.id === val) ? (val as string) : fallback;
}

export function loadSavedTheme(): ThemeConfig {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeConfig>;
      return {
        base: normalizeHex(parsed.base, DEFAULT_THEME.base),
        accent: normalizeHex(parsed.accent, DEFAULT_THEME.accent),
        uiStyle: normalizeOpt(parsed.uiStyle, UI_STYLES, DEFAULT_THEME.uiStyle),
        shaderMode: normalizeOpt(parsed.shaderMode, SHADER_MODES, DEFAULT_THEME.shaderMode),
        glowMode: normalizeOpt(parsed.glowMode, GLOW_MODES, DEFAULT_THEME.glowMode),
      };
    }
  } catch {
    // Ignore storage errors
  }
  return { ...DEFAULT_THEME };
}

export function applyThemeToDocument(theme: Partial<ThemeConfig>, persist = true): {
  theme: ThemeConfig;
  isLight: boolean;
  textContrast: number;
  accentContrast: number;
  accentRgb: Rgb;
  accentBrightRgb: Rgb;
} {
  const current: ThemeConfig = {
    base: normalizeHex(theme.base, DEFAULT_THEME.base),
    accent: normalizeHex(theme.accent, DEFAULT_THEME.accent),
    uiStyle: normalizeOpt(theme.uiStyle, UI_STYLES, DEFAULT_THEME.uiStyle),
    shaderMode: normalizeOpt(theme.shaderMode, SHADER_MODES, DEFAULT_THEME.shaderMode),
    glowMode: normalizeOpt(theme.glowMode, GLOW_MODES, DEFAULT_THEME.glowMode),
  };

  const baseRgb = hexToRgb(current.base);
  const accentRgb = hexToRgb(current.accent);
  const isLight = relLuminance(baseRgb) >= 0.32;

  const white: Rgb = { r: 255, g: 255, b: 255 };
  const black: Rgb = { r: 0, g: 0, b: 0 };

  const insetRgb = isLight ? mixRgb(baseRgb, black, 0.07) : mixRgb(baseRgb, black, 0.34);
  const surfaceRgb = isLight ? mixRgb(baseRgb, white, 0.56) : mixRgb(baseRgb, white, 0.036);
  const surface2Rgb = isLight ? mixRgb(baseRgb, black, 0.035) : mixRgb(baseRgb, white, 0.075);

  const textRgb: Rgb = isLight ? { r: 20, g: 22, b: 26 } : { r: 230, g: 231, b: 235 };
  const mutedRgb: Rgb = isLight ? { r: 74, g: 82, b: 96 } : { r: 147, g: 152, b: 163 };
  const subtleRgb: Rgb = isLight ? { r: 112, g: 120, b: 133 } : { r: 102, g: 108, b: 119 };

  const accentBrightRgb = isLight ? mixRgb(accentRgb, black, 0.16) : mixRgb(accentRgb, white, 0.2);
  const darkInk: Rgb = { r: 11, g: 12, b: 14 };
  const lightInk: Rgb = { r: 255, g: 255, b: 255 };
  const onAccentRgb = contrastRatio(accentRgb, darkInk) >= contrastRatio(accentRgb, lightInk) ? darkInk : lightInk;

  const root = document.documentElement;
  root.style.colorScheme = isLight ? "light" : "dark";
  root.dataset.uiStyle = current.uiStyle;
  root.dataset.glowMode = current.glowMode;

  const vars: Record<string, string> = {
    "--bg": current.base,
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
    "--accent": current.accent,
    "--accent-bright": rgbToHex(accentBrightRgb),
    "--accent-dim": rgbaStr(accentRgb, isLight ? 0.14 : 0.15),
    "--accent-border": rgbaStr(accentRgb, 0.36),
    "--accent-glow": rgbaStr(accentRgb, 0.22),
    "--on-accent": rgbToHex(onAccentRgb),
  };
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Ignore storage errors
    }
  }

  return {
    theme: current,
    isLight,
    textContrast: contrastRatio(textRgb, baseRgb),
    accentContrast: contrastRatio(onAccentRgb, accentRgb),
    accentRgb,
    accentBrightRgb,
  };
}
