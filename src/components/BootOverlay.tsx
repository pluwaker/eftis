import React from "react";
import logoImg from "../assets/logo.png";

interface BootOverlayProps {
  visible: boolean;
  progress: number;
  stageText: string;
  onOpenConsole?: () => void;
}

export const BootOverlay: React.FC<BootOverlayProps> = ({ visible, progress, stageText, onOpenConsole }) => {
  if (!visible) return null;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className={`engine-boot-overlay${pct >= 100 ? " done" : ""}`} id="engineBootOverlay" aria-hidden="true">
      <div className="engine-boot-card">
        <div className="boot-brand-row">
          <div className="brand-mark"><img className="brand-mark-img" src={logoImg} alt="EFT" /></div>
          <div>
            <div className="boot-title">Eftis</div>
            <div className="boot-sub" id="bootStageText">{stageText}</div>
          </div>
        </div>
        <div className="boot-bar-track">
          <div className="boot-bar-fill" id="bootBarFill" style={{ width: `${pct}%` }} />
        </div>
        {onOpenConsole && (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={onOpenConsole}>
              Console (F12)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
