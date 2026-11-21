import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import {
  DEFAULT_THEME,
  GLOW_MODES,
  SHADER_MODES,
  THEME_PRESETS,
  ThemeConfig,
  UI_STYLES,
  normalizeHex,
} from "../theme/theme";

interface ThemeModalProps {
  open: boolean;
  theme: ThemeConfig;
  textContrast: number;
  accentContrast: number;
  onChange: (next: ThemeConfig) => void;
  onClose: () => void;
}

export const ThemeModal: React.FC<ThemeModalProps> = ({
  open,
  theme,
  textContrast,
  accentContrast,
  onChange,
  onClose,
}) => {
  const { lang, t } = useI18n();
  const [baseHexInput, setBaseHexInput] = useState(theme.base);
  const [accentHexInput, setAccentHexInput] = useState(theme.accent);

  useEffect(() => {
    setBaseHexInput(theme.base);
    setAccentHexInput(theme.accent);
  }, [theme.base, theme.accent]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      data-open="true"
      id="themeModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="themeModalTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal panel-dialog"
        style={{ width: "min(580px, calc(100vw - 32px))", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-header">
          <div>
            <h3 id="themeModalTitle">{t("theme_title")}</h3>
            <p className="muted">{t("theme_sub")}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body stack-col" style={{ gap: 14, padding: "16px 18px", overflowY: "auto" }}>
          <div className="field">
            <label>{t("theme_style_lbl")}</label>
            <div className="style-options-grid">
              {UI_STYLES.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`style-opt-btn${theme.uiStyle === it.id ? " active" : ""}`}
                  onClick={() => onChange({ ...theme, uiStyle: it.id })}
                >
                  <span className="style-opt-title">{it.name[lang]}</span>
                  <span className="style-opt-sub">{it.desc[lang]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t("theme_shader_lbl")}</label>
            <div className="style-options-grid">
              {SHADER_MODES.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`style-opt-btn${theme.shaderMode === it.id ? " active" : ""}`}
                  onClick={() => onChange({ ...theme, shaderMode: it.id })}
                >
                  <span className="style-opt-title">{it.name[lang]}</span>
                  <span className="style-opt-sub">{it.desc[lang]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t("theme_glow_lbl")}</label>
            <div className="style-options-grid cols-3">
              {GLOW_MODES.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`style-opt-btn${theme.glowMode === it.id ? " active" : ""}`}
                  onClick={() => onChange({ ...theme, glowMode: it.id })}
                >
                  <span className="style-opt-title">{it.name[lang]}</span>
                  <span className="style-opt-sub">{it.desc[lang]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t("theme_presets_lbl")}</label>
            <div className="theme-presets-grid">
              {THEME_PRESETS.map((p) => {
                const active = theme.base === p.base && theme.accent === p.accent;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`theme-preset-btn${active ? " active" : ""}`}
                    onClick={() => onChange({ ...theme, base: p.base, accent: p.accent })}
                  >
                    <span className="theme-preset-swatches">
                      <span className="swatch-b" style={{ background: p.base }} />
                      <span className="swatch-a" style={{ background: p.accent }} />
                    </span>
                    <span className="theme-preset-name">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="theme-pickers-grid">
            <div className="field">
              <label>{t("theme_base_lbl")}</label>
              <div className="theme-color-control">
                <input
                  type="color"
                  className="theme-color-swatch"
                  value={theme.base}
                  onChange={(e) => onChange({ ...theme, base: e.target.value })}
                />
                <input
                  type="text"
                  className="input num theme-hex-input"
                  maxLength={7}
                  value={baseHexInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBaseHexInput(v);
                    if (/^#[0-9a-fA-F]{6}$/.test(v.trim())) {
                      onChange({ ...theme, base: normalizeHex(v, theme.base) });
                    }
                  }}
                />
              </div>
            </div>
            <div className="field">
              <label>{t("theme_accent_lbl")}</label>
              <div className="theme-color-control">
                <input
                  type="color"
                  className="theme-color-swatch"
                  value={theme.accent}
                  onChange={(e) => onChange({ ...theme, accent: e.target.value })}
                />
                <input
                  type="text"
                  className="input num theme-hex-input"
                  maxLength={7}
                  value={accentHexInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAccentHexInput(v);
                    if (/^#[0-9a-fA-F]{6}$/.test(v.trim())) {
                      onChange({ ...theme, accent: normalizeHex(v, theme.accent) });
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <div className="theme-contrast-row">
            <span>{t("theme_contrast_text")} <b className="num">{textContrast.toFixed(1)}:1</b></span>
            <span>{t("theme_contrast_accent")} <b className="num">{accentContrast.toFixed(1)}:1</b></span>
          </div>

          <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 2 }}>
            <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...DEFAULT_THEME })}>
              {t("theme_reset")}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t("theme_done")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
