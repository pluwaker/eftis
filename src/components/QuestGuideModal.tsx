import React, { useEffect, useState } from "react";
import { mediaProxyUrl } from "../api/client";
import { useI18n } from "../i18n/I18nContext";
import { fmtNum, fmtRub } from "../utils/format";

export interface GuideSectionBlock {
  type: "p" | "list" | "table";
  text?: string;
  items?: string[];
  rows?: string[][];
}

export interface GuideSection {
  level?: number;
  title: string;
  blocks?: GuideSectionBlock[];
  images?: { url: string; caption?: string }[];
}

export interface GuideData {
  taskId: string;
  taskName?: string;
  traderName?: string;
  wikiLink?: string;
  guideUrl?: string;
  guideSource?: string;
  source?: string;
  wikiAvailable?: boolean;
  wikiSections?: GuideSection[];
  wikiImages?: { url: string; caption?: string }[];
  images?: string[];
  briefing?: {
    taskId?: string;
    name?: string;
    traderName?: string;
    mapName?: string;
    minPlayerLevel?: number;
    experience?: number;
    kappaRequired?: boolean;
    lightkeeperRequired?: boolean;
    restartable?: boolean;
    taskImageLink?: string;
    wikiLink?: string;
    objectives?: {
      type?: string;
      description?: string;
      itemName?: string;
      itemIcon?: string;
      markerItemName?: string;
      count?: number;
      foundInRaid?: boolean;
      optional?: boolean;
      mapNames?: string[];
      requiredKeys?: { name: string }[];
    }[];
    neededKeys?: { name: string; price?: number }[];
    prereqs?: { id: string; name: string }[];
    unlocks?: { id: string; name: string }[];
    rewards?: {
      items?: { name: string; count?: number; iconLink?: string }[];
      standing?: { traderName: string; standing: number }[];
      offers?: { itemName: string; traderName: string; level: number; iconLink?: string }[];
      crafts?: { stationName: string; level: number; rewardItemName?: string }[];
      skills?: { name: string; level: number }[];
    };
  };
}

interface QuestGuideModalProps {
  open: boolean;
  data: GuideData | null;
  taskStatus?: string;
  hudText: string | null;
  onClose: () => void;
  onRefresh: (taskId: string) => void;
  onNavigateQuest: (taskId: string) => void;
  onSetStatus: (taskId: string, status: "active" | "completed") => void;
}

function getObjectiveTypeLabel(type: string | undefined, lang: string): [string, string] {
  const ru: Record<string, [string, string]> = {
    visit: ["Посетить", ""],
    mark: ["Маркер", "amber"],
    plantItem: ["Закладка", "amber"],
    giveItem: ["Передать", "green"],
    findItem: ["Найти", "green"],
    shoot: ["Убийство", "red"],
    extract: ["Выход", ""],
    skill: ["Навык", ""],
    traderLevel: ["Репутация", ""],
    experience: ["Опыт", ""],
    taskStatus: ["Условие", ""],
    buildWeapon: ["Сборка", "amber"],
    useItem: ["Использовать", ""],
  };
  const en: Record<string, [string, string]> = {
    visit: ["Visit", ""],
    mark: ["Mark", "amber"],
    plantItem: ["Plant", "amber"],
    giveItem: ["Hand Over", "green"],
    findItem: ["Find", "green"],
    shoot: ["Eliminate", "red"],
    extract: ["Extract", ""],
    skill: ["Skill", ""],
    traderLevel: ["Rep", ""],
    experience: ["XP", ""],
    taskStatus: ["Condition", ""],
    buildWeapon: ["Gunsmith", "amber"],
    useItem: ["Use", ""],
  };
  const map = lang === "en" ? en : ru;
  return (type && map[type]) || [lang === "en" ? "Objective" : "Цель", ""];
}

export const QuestGuideModal: React.FC<QuestGuideModalProps> = ({
  open,
  data,
  taskStatus = "available",
  hudText,
  onClose,
  onRefresh,
  onNavigateQuest,
  onSetStatus,
}) => {
  const { lang, t } = useI18n();
  const [subtab, setSubtab] = useState<"steps" | "rewards" | "gallery">("steps");
  const [lightbox, setLightbox] = useState<{ src: string; caption: string } | null>(null);

  useEffect(() => {
    setSubtab("steps");
  }, [data?.taskId]);

  useEffect(() => {
    if (!open && !lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lightbox, onClose]);

  const br = data?.briefing || {};
  const finalTitle = br.name || data?.taskName || (lang === "en" ? "Quest" : "Квест");
  const statusMap: Record<string, [string, string]> = {
    active: [t("status_active"), "amber"],
    available: [t("status_available"), ""],
    completed: [t("status_completed"), "green"],
    failed: [t("status_failed"), "red"],
    locked: [t("status_locked"), ""],
  };
  const [statusLabel, statusCls] = statusMap[taskStatus] || [t("status_available"), ""];
  const srcLabel = data?.wikiAvailable
    ? t(data.source === "en" ? "guide_src_help_en" : "guide_src_help_ru")
    : t("guide_src_dev");
  const previewImg = mediaProxyUrl(br.taskImageLink || (data?.images && data.images[0]) || "");
  const extUrl = data?.guideUrl || br.wikiLink || data?.wikiLink || "";
  const objs = br.objectives || [];
  const keys = br.neededKeys || [];
  const prereqs = br.prereqs || [];
  const unlocks = br.unlocks || [];
  const rew = br.rewards || {};
  const rewCount =
    (rew.items?.length || 0) +
    (rew.standing?.length || 0) +
    (rew.offers?.length || 0) +
    (rew.crafts?.length || 0) +
    (rew.skills?.length || 0);
  const steps = data?.wikiSections || [];
  const wikiImgs =
    data?.wikiImages && data.wikiImages.length
      ? data.wikiImages
      : (data?.images || []).map((url) => ({ url, caption: "" }));

  const itemLbl = lang === "en" ? "Item:" : "Предмет:";
  const markerLbl = lang === "en" ? "Marker:" : "Маркер:";
  const keyLbl = lang === "en" ? "Key:" : "Ключ:";
  const objDefaultLbl = lang === "en" ? "Complete objective" : "Выполнить условие";
  const detailTag = lang === "en" ? "NOTE" : "ДЕТАЛЬ";
  const stepPrefix = lang === "en" ? "STEP" : "ШАГ";

  let mainStepBadgeNum = 0;

  return (
    <>
      {hudText && (
        <div className="guide-loader-hud" data-open="true" id="guideLoaderHud" role="status" aria-live="polite">
          <div className="guide-loader-head">
            <span className="glyph-spinner glyph-anim">⠋</span>
            <span className="guide-loader-title">{t("guide_hud_title")}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }} id="guideLoaderSub">{hudText}</div>
        </div>
      )}

      {open && data && (
        <div
          className="modal-backdrop"
          data-open="true"
          id="questGuideModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guideModalTitle"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="modal-dialog guide-modal">
            <div className="modal-header guide-hero-head">
              <div className="guide-hero-left">
                {previewImg && (
                  <div
                    className="guide-hero-thumb"
                    id="guideHeroThumbWrap"
                    onClick={() => setLightbox({ src: previewImg, caption: finalTitle })}
                  >
                    <img id="guideHeroThumb" src={previewImg} alt={finalTitle} referrerPolicy="no-referrer" />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                    <span className="badge amber">{t("guide_badge_briefing")}</span>
                    <span id="guideModalBadges" style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
                      <span className={`badge ${statusCls}`}>{statusLabel}</span>
                      {br.kappaRequired && <span className="badge amber">{t("badge_kappa")}</span>}
                      {br.lightkeeperRequired && <span className="badge">{t("tree_chain_lk")}</span>}
                      {br.restartable && <span className="badge">{t("guide_restartable")}</span>}
                    </span>
                  </div>
                  <h3 id="guideModalTitle" style={{ margin: 0, fontSize: 16, lineHeight: 1.2 }}>{finalTitle}</h3>
                  <p className="muted" style={{ marginTop: 3, fontSize: "11.5px" }}>
                    {br.traderName || data.traderName || "—"} • {br.mapName || t("any_map")} • {srcLabel}
                  </p>
                </div>
              </div>
              <div className="guide-hero-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  title={t("guide_btn_refresh_title")}
                  onClick={() => onRefresh(data.taskId)}
                >
                  {t("guide_btn_refresh")}
                </button>
                <button type="button" className="btn btn-ghost" id="btnCloseGuideModal" style={{ fontSize: 16, lineHeight: 1, padding: "4px 8px" }} onClick={onClose}>
                  ✕
                </button>
              </div>
            </div>

            <div className="modal-body guide-modal-body">
              <div className="guide-brief-grid">
                <div className="guide-card">
                  <div className="guide-card-title">
                    <span>{t("guide_objectives_title")}</span>
                    <span className="num muted">{objs.length}</span>
                  </div>
                  {objs.length ? (
                    <div className="guide-obj-list">
                      {objs.map((ob, idx) => {
                        const [tLbl, tCls] = getObjectiveTypeLabel(ob.type, lang);
                        const mapStr = (ob.mapNames || []).join(", ");
                        return (
                          <div key={idx} className="guide-obj-row">
                            <span className="guide-obj-num">{String(idx + 1).padStart(2, "0")}</span>
                            {ob.itemIcon && <img className="guide-obj-ico" src={ob.itemIcon} alt="" referrerPolicy="no-referrer" />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--text)" }}>
                                {ob.description || ob.itemName || objDefaultLbl}
                              </div>
                              {ob.itemName ? (
                                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                  {itemLbl} <b>{ob.itemName}</b>{(ob.count || 1) > 1 ? ` ×${ob.count}` : ""}
                                </div>
                              ) : ob.markerItemName ? (
                                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                  {markerLbl} <b>{ob.markerItemName}</b>
                                </div>
                              ) : null}
                              {(ob.requiredKeys || []).length > 0 && (
                                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                  {keyLbl} {(ob.requiredKeys || []).map((k) => k.name).join(" / ")}
                                </div>
                              )}
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                                <span className={`badge ${tCls}`}>{tLbl}</span>
                                {ob.foundInRaid && <span className="badge amber">FIR</span>}
                                {ob.optional && <span className="badge">{t("guide_optional")}</span>}
                                {(ob.count || 1) > 1 && <span className="badge num">×{ob.count}</span>}
                                {mapStr && <span className="badge">{mapStr}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>{t("guide_rewards_empty")}</div>
                  )}
                </div>

                <div className="guide-card">
                  <div className="guide-card-title">
                    <span>{t("guide_chain_title")} &amp; {t("guide_prep_keys")}</span>
                  </div>
                  {keys.length ? (
                    <div style={{ marginBottom: 10 }}>
                      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t("guide_prep_keys")}:</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {keys.map((k, i) => (
                          <div key={i} className="list-row" style={{ padding: "5px 8px" }}>
                            <b style={{ fontSize: 12 }}>{k.name}</b>
                            {k.price ? <span className="num muted" style={{ fontSize: 11 }}>{fmtRub(k.price, lang)}</span> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: "11.5px", marginBottom: 10 }}>{t("need_keys_empty")}</div>
                  )}

                  {prereqs.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t("guide_chain_prev")}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {prereqs.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: "3px 7px", fontSize: 11 }}
                            onClick={() => onNavigateQuest(p.id)}
                          >
                            ← {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {unlocks.length > 0 && (
                    <div>
                      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t("guide_chain_next")}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {unlocks.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: "3px 7px", fontSize: 11 }}
                            onClick={() => onNavigateQuest(u.id)}
                          >
                            → {u.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="subtabs" style={{ marginTop: 14, marginBottom: 12 }}>
                <button
                  type="button"
                  className={`subtab-btn${subtab === "steps" ? " active" : ""}`}
                  onClick={() => setSubtab("steps")}
                >
                  {t("guide_tab_steps")} ({steps.length})
                </button>
                <button
                  type="button"
                  className={`subtab-btn${subtab === "rewards" ? " active" : ""}`}
                  onClick={() => setSubtab("rewards")}
                >
                  {t("guide_tab_rewards")} ({rewCount})
                </button>
                <button
                  type="button"
                  className={`subtab-btn${subtab === "gallery" ? " active" : ""}`}
                  onClick={() => setSubtab("gallery")}
                >
                  {t("guide_tab_gallery")} ({wikiImgs.length})
                </button>
              </div>

              {subtab === "steps" && (
                steps.length ? (
                  <div className="guide-steps-wrap">
                    {steps.map((sec, sIdx) => {
                      const isSub = (sec.level || 2) >= 3;
                      if (!isSub) mainStepBadgeNum += 1;
                      const badgeText = isSub ? detailTag : `${stepPrefix} ${String(mainStepBadgeNum).padStart(2, "0")}`;
                      return (
                        <div key={sIdx} className={`guide-step-card${isSub ? " substep" : ""}`}>
                          <div className="guide-step-head">
                            <span className="guide-step-badge">{badgeText}</span>
                            <span className="guide-step-title">{sec.title}</span>
                          </div>
                          {(sec.blocks || []).length > 0 && (
                            <div className="guide-step-body">
                              {(sec.blocks || []).map((blk, bIdx) => {
                                if (blk.type === "p") return <p key={bIdx}>{blk.text}</p>;
                                if (blk.type === "list") {
                                  return (
                                    <ul key={bIdx}>
                                      {(blk.items || []).map((li, lIdx) => <li key={lIdx}>{li}</li>)}
                                    </ul>
                                  );
                                }
                                if (blk.type === "table" && blk.rows?.length) {
                                  const [hdr, ...rows] = blk.rows;
                                  return (
                                    <div key={bIdx} className="guide-table-wrap">
                                      <table className="guide-table">
                                        <thead>
                                          <tr>{hdr.map((h, hIdx) => <th key={hIdx}>{h}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                          {rows.map((r, rIdx) => (
                                            <tr key={rIdx}>{r.map((c, cIdx) => <td key={cIdx}>{c}</td>)}</tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          )}
                          {(sec.images || []).length > 0 && (
                            <div className="guide-step-gallery">
                              {(sec.images || []).map((im, iIdx) => {
                                const src = mediaProxyUrl(im.url);
                                return (
                                  <div
                                    key={iIdx}
                                    className="guide-thumb-wrap"
                                    tabIndex={0}
                                    role="button"
                                    onClick={() => setLightbox({ src, caption: im.caption || sec.title })}
                                  >
                                    <img src={src} alt={im.caption || sec.title} loading="eager" referrerPolicy="no-referrer" />
                                    {im.caption && <div className="guide-thumb-caption">{im.caption}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="guide-fallback-banner">
                    <div>
                      <b>{lang === "en" ? "Tarkov.Help walkthrough not found" : "Гайд на Tarkov.Help не найден"}</b>
                      <div className="muted" style={{ marginTop: 2 }}>{t("guide_no_walkthrough")}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-secondary" onClick={() => onRefresh(data.taskId)}>
                        {t("guide_btn_refresh")}
                      </button>
                      {extUrl && (
                        <a href={extUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                          {extUrl.includes("tarkov.help") ? t("guide_btn_open_help") : t("guide_btn_open_dev")}
                        </a>
                      )}
                    </div>
                  </div>
                )
              )}

              {subtab === "rewards" && (
                <div className="stack-col" style={{ gap: 12 }}>
                  {(rew.items || []).length > 0 && (
                    <div>
                      <div className="guide-card-title"><span>{t("guide_rewards_items")}</span></div>
                      <div className="guide-rewards-grid">
                        {(rew.items || []).map((it, idx) => (
                          <div key={idx} className="guide-reward-card">
                            {it.iconLink && <img className="guide-obj-ico" src={it.iconLink} alt="" referrerPolicy="no-referrer" />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{it.name}</div>
                              <div className="num muted" style={{ fontSize: 11 }}>×{fmtNum(it.count || 1, lang)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(rew.standing || []).length > 0 && (
                    <div>
                      <div className="guide-card-title"><span>{t("guide_rewards_rep")}</span></div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {(rew.standing || []).map((s, idx) => (
                          <span key={idx} className={`badge ${s.standing >= 0 ? "green" : "red"}`}>
                            {s.traderName}: {s.standing >= 0 ? "+" : ""}{s.standing}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(rew.offers || []).length > 0 && (
                    <div>
                      <div className="guide-card-title"><span>{t("guide_rewards_offers")}</span></div>
                      <div className="guide-rewards-grid">
                        {(rew.offers || []).map((o, idx) => (
                          <div key={idx} className="guide-reward-card">
                            {o.iconLink && <img className="guide-obj-ico" src={o.iconLink} alt="" referrerPolicy="no-referrer" />}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{o.itemName}</div>
                              <div className="muted" style={{ fontSize: 11 }}>{o.traderName} • {t("th_lvl")} {o.level}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(rew.crafts || []).length > 0 && (
                    <div>
                      <div className="guide-card-title"><span>{t("guide_rewards_crafts")}</span></div>
                      <div className="guide-rewards-grid">
                        {(rew.crafts || []).map((c, idx) => (
                          <div key={idx} className="guide-reward-card">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{c.rewardItemName || c.stationName}</div>
                              <div className="muted" style={{ fontSize: 11 }}>{c.stationName} • {t("th_lvl")} {c.level}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {rewCount === 0 && <div className="muted">{t("guide_rewards_empty")}</div>}
                </div>
              )}

              {subtab === "gallery" && (
                wikiImgs.length ? (
                  <div className="guide-step-gallery">
                    {wikiImgs.map((im, idx) => {
                      const src = mediaProxyUrl(im.url);
                      return (
                        <div
                          key={idx}
                          className="guide-thumb-wrap"
                          tabIndex={0}
                          role="button"
                          onClick={() => setLightbox({ src, caption: im.caption || finalTitle })}
                        >
                          <img src={src} alt={im.caption || finalTitle} loading="eager" referrerPolicy="no-referrer" />
                          {im.caption && <div className="guide-thumb-caption">{im.caption}</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted">{t("guide_gallery_empty")}</div>
                )
              )}
            </div>

            <div className="modal-footer guide-modal-footer">
              {extUrl ? (
                <a href={extUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ fontSize: 12 }}>
                  {extUrl.includes("tarkov.help") ? t("guide_btn_open_help") : t("guide_btn_open_dev")}
                </a>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>
                  {t("th_lvl")} {br.minPlayerLevel || 1} • {fmtNum(br.experience || 0, lang)} XP
                </div>
              )}
              <div id="guideFooterActions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="btn btn-ghost" onClick={() => onSetStatus(data.taskId, "active")}>
                  {t("guide_mark_active")}
                </button>
                <button type="button" className="btn btn-primary" onClick={() => onSetStatus(data.taskId, "completed")}>
                  {t("guide_mark_completed")}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  {t("guide_btn_close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="lightbox-backdrop"
          data-open="true"
          id="screenshotLightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <img id="lightboxImg" src={lightbox.src} alt={lightbox.caption} referrerPolicy="no-referrer" />
          <div className="lightbox-caption" id="lightboxCaption">{lightbox.caption}</div>
        </div>
      )}
    </>
  );
};
