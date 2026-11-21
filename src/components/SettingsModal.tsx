import React, { useEffect, useState } from "react";
import { isTauriEnv, pickFolderDialog } from "../api/client";
import { useI18n } from "../i18n/I18nContext";
import { BootstrapConfig, GameMode } from "../types/api";

interface SettingsModalProps {
  open: boolean;
  config?: BootstrapConfig;
  onClose: () => void;
  onSave: (payload: Partial<BootstrapConfig>) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, config, onClose, onSave }) => {
  const { lang, t } = useI18n();
  const [defaultMode, setDefaultMode] = useState<GameMode>("regular");
  const [watchLogs, setWatchLogs] = useState(true);
  const [watchScreenshots, setWatchScreenshots] = useState(true);
  const [logsDir, setLogsDir] = useState("");
  const [screensDir, setScreensDir] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && config) {
      setDefaultMode(config.default_game_mode === "pve" ? "pve" : "regular");
      setWatchLogs(config.watch_logs !== false);
      setWatchScreenshots(config.watch_screenshots !== false);
      setLogsDir(config.eft_logs_dir || "");
      setScreensDir(config.eft_screenshots_dir || "");
    }
  }, [open, config]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tauri = isTauriEnv();
  const browseLabel = lang === "en" ? "Browse" : "Выбрать";

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        default_game_mode: defaultMode,
        watch_logs: watchLogs,
        watch_screenshots: watchScreenshots,
        eft_logs_dir: logsDir.trim(),
        eft_screenshots_dir: screensDir.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      data-open="true"
      id="settingsModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settingsModalTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal panel-dialog">
        <div className="modal-header">
          <div>
            <h3 id="settingsModalTitle">{t("settings_title")}</h3>
            <p className="muted">{t("settings_desc")}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body stack-col" style={{ gap: 12, padding: "16px 18px" }}>
          <div className="field">
            <label>{t("settings_default_mode")}</label>
            <select className="select full" value={defaultMode} onChange={(e) => setDefaultMode(e.target.value === "pve" ? "pve" : "regular")}>
              <option value="regular">{t("settings_mode_pvp")}</option>
              <option value="pve">{t("settings_mode_pve")}</option>
            </select>
          </div>

          <label className="check-item">
            <input type="checkbox" checked={watchLogs} onChange={(e) => setWatchLogs(e.target.checked)} />
            <span>{t("settings_watch_logs")}</span>
          </label>
          <label className="check-item">
            <input type="checkbox" checked={watchScreenshots} onChange={(e) => setWatchScreenshots(e.target.checked)} />
            <span>{t("settings_watch_screens")}</span>
          </label>

          <div className="field">
            <label>{t("settings_logs_dir")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" className="input full" value={logsDir} onChange={(e) => setLogsDir(e.target.value)} placeholder="Auto" />
              {tauri && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    const p = await pickFolderDialog(t("settings_logs_dir"));
                    if (p) setLogsDir(p);
                  }}
                >
                  {browseLabel}
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label>{t("settings_screens_dir")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" className="input full" value={screensDir} onChange={(e) => setScreensDir(e.target.value)} placeholder="Auto" />
              {tauri && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    const p = await pickFolderDialog(t("settings_screens_dir"));
                    if (p) setScreensDir(p);
                  }}
                >
                  {browseLabel}
                </button>
              )}
            </div>
          </div>

          <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t("settings_cancel")}</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {t("settings_save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
