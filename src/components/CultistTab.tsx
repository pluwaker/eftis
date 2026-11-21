import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n/I18nContext";
import { GameMode } from "../types/api";
import { fmtRub } from "../utils/format";
import { ItemAutocomplete, SearchedItem } from "./ItemAutocomplete";

interface CultistSolution {
  slotsUsed: number;
  totalBaseValue: number;
  efficiency: number;
  totalCost: number;
  items: { qty: number; name: string; source: string; cost: number; basePrice: number }[];
}

interface CultistTimer {
  id: number;
  duration_hours: number;
  note?: string;
  ends_at: string;
}

interface BasketEvalResult {
  slotsUsed: number;
  totalBaseValue: number;
  totalCost: number;
  tier: string;
  items: { id: string; name: string; qty: number; unitBase: number }[];
}

interface CultistTabProps {
  active: boolean;
  mode: GameMode;
  dataRev: number;
  onToast: (msg: string) => void;
}

export const CultistTab: React.FC<CultistTabProps> = ({ active, mode, dataRev, onToast }) => {
  const { lang, t } = useI18n();
  const [target, setTarget] = useState("400000");
  const [slots, setSlots] = useState("5");
  const [allowTraders, setAllowTraders] = useState(true);
  const [loading, setLoading] = useState(false);
  const [solutions, setSolutions] = useState<CultistSolution[]>([]);
  const [timers, setTimers] = useState<CultistTimer[]>([]);
  const [basket, setBasket] = useState<{ id: string; name: string; qty: number }[]>([]);
  const [basketEval, setBasketEval] = useState<BasketEvalResult | null>(null);
  const [, setTick] = useState(0);

  const solve = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ solutions: CultistSolution[]; timers: CultistTimer[] }>(
        `/api/cultist/solve?mode=${mode}&target=${target}&slots=${slots}&traders=${allowTraders ? "1" : "0"}`,
        lang,
      );
      setSolutions(data.solutions || []);
      setTimers(data.timers || []);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mode, lang, target, slots, allowTraders, onToast]);

  useEffect(() => {
    if (active) {
      void solve();
    }
  }, [active, mode, lang, dataRev, solve]);

  useEffect(() => {
    if (!active || timers.length === 0) return;
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [active, timers.length]);

  const evaluateBasket = useCallback(
    async (itemsList: { id: string; name: string; qty: number }[]) => {
      if (!itemsList.length) {
        setBasketEval(null);
        return;
      }
      try {
        const res = await apiFetch<BasketEvalResult>("/api/cultist/evaluate", lang, {
          method: "POST",
          body: JSON.stringify({ mode, allowTraders, items: itemsList }),
        });
        setBasketEval(res);
      } catch (err) {
        onToast((err as Error).message);
      }
    },
    [mode, lang, allowTraders, onToast],
  );

  const startTimer = async (hours: number) => {
    const note =
      hours === 6
        ? lang === "en"
          ? "Quest / Hideout chance"
          : "Шанс квест/Убежище"
        : lang === "en"
          ? "Rare loot pool"
          : "Редкий лут";
    try {
      const res = await apiFetch<{ timers: CultistTimer[] }>("/api/cultist/timer", lang, {
        method: "POST",
        body: JSON.stringify({ mode, hours, note }),
      });
      setTimers(res.timers || []);
      onToast(
        lang === "en"
          ? `Cultist Circle ${hours}h timer started`
          : `Таймер Круга Сектантов на ${hours}ч запущен`,
      );
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const deleteTimer = async (id: number) => {
    try {
      await apiFetch(`/api/cultist/timer/${id}`, lang, { method: "DELETE" });
      setTimers((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleSelectBasketItem = (item: SearchedItem) => {
    const totalSlots = basket.reduce((s, x) => s + x.qty, 0);
    if (totalSlots >= 5) {
      onToast(lang === "en" ? "Maximum 5 items in Cultist Circle" : "Максимум 5 предметов в Круге Сектантов");
      return;
    }
    const next = [...basket];
    const ex = next.find((x) => x.id === item.id);
    if (ex) ex.qty += 1;
    else next.push({ id: item.id, name: item.name, qty: 1 });
    setBasket(next);
    void evaluateBasket(next);
  };

  const removeBasketItem = (idx: number) => {
    const next = basket.filter((_, i) => i !== idx);
    setBasket(next);
    void evaluateBasket(next);
  };

  const slotUnit = lang === "en" ? "slots" : "сл.";
  const effLbl = lang === "en" ? "ratio" : "коэфф.";
  const hrUnit = lang === "en" ? "h" : "ч";
  const defNote = lang === "en" ? "Ritual" : "Ритуал";
  const remPrefix = lang === "en" ? "Remaining" : "Осталось";
  const slotsLbl = lang === "en" ? "Slots:" : "Слотов:";
  const forecastLbl = lang === "en" ? "Tier forecast:" : "Прогноз:";
  const now = Date.now();

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-cultist">
      <header className="view-header">
        <div className="view-header-title">
          <h1>{t("cultist_title")}</h1>
        </div>
      </header>

      <div className="split-2col">
        <section className="panel-section">
          <div className="pane-head">
            <h2>{t("cultist_solver_title")}</h2>
          </div>
          <div className="toolbar wrap" style={{ marginBottom: 12 }}>
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="400000">{t("cultist_target_400")}</option>
              <option value="350001">{t("cultist_target_350")}</option>
            </select>
            <select className="select" value={slots} onChange={(e) => setSlots(e.target.value)}>
              <option value="5">{t("cultist_slots_5")}</option>
              <option value="4">{t("cultist_slots_4")}</option>
              <option value="3">{t("cultist_slots_3")}</option>
              <option value="2">{t("cultist_slots_2")}</option>
              <option value="1">{t("cultist_slots_1")}</option>
            </select>
            <label className="check-item">
              <input type="checkbox" checked={allowTraders} onChange={(e) => setAllowTraders(e.target.checked)} />
              <span>{t("cultist_traders")}</span>
            </label>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={solve}>
              {loading ? t("cultist_btn_busy") : t("cultist_btn_solve")}
            </button>
          </div>
          <div id="cultistSolutions" className="solutions-list">
            {loading ? (
              <div className="muted">{t("cultist_loader_title")} — {t("cultist_loader_sub")}</div>
            ) : solutions.length ? (
              solutions.map((sol, idx) => (
                <div key={idx} className="solution-card">
                  <div className="card-header" style={{ marginBottom: 8 }}>
                    <div>
                      <b>{t("cultist_variant", { idx: idx + 1 })}</b> •{" "}
                      <span className="num">{sol.slotsUsed} {slotUnit}</span>
                      <div className="muted">
                        Base Value: <b className="num">{fmtRub(sol.totalBaseValue, lang)}</b> ({effLbl} {sol.efficiency}×)
                      </div>
                    </div>
                    <span className="badge green num">{t("cultist_cost")} {fmtRub(sol.totalCost, lang)}</span>
                  </div>
                  <div className="mini-list">
                    {sol.items.map((it, i) => (
                      <div key={i} className="list-row">
                        <div><b>{it.qty}× {it.name}</b> <span className="muted">({it.source})</span></div>
                        <div className="num muted">{fmtRub(it.cost, lang)} / Base {fmtRub(it.basePrice, lang)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">{t("cultist_no_sol")}</div>
            )}
          </div>
        </section>

        <div className="stack-col" style={{ gap: 20 }}>
          <section className="panel-section">
            <div className="pane-head">
              <h2>{t("cultist_timers_title")}</h2>
              <div className="toolbar">
                <button type="button" className="btn btn-secondary" onClick={() => startTimer(6)}>+ 6h</button>
                <button type="button" className="btn btn-secondary" onClick={() => startTimer(14)}>+ 14h</button>
              </div>
            </div>
            <div id="cultistTimers" className="mini-list">
              {timers.length ? (
                timers.map((tm) => {
                  const diff = Math.max(0, Math.floor((Date.parse(tm.ends_at) - now) / 1000));
                  const hh = String(Math.floor(diff / 3600)).padStart(2, "0");
                  const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
                  const ss = String(diff % 60).padStart(2, "0");
                  return (
                    <div key={tm.id} className="list-row">
                      <div>
                        <b>{tm.duration_hours}{hrUnit} • {tm.note || defNote}</b>
                        <div className="muted">
                          {diff === 0 ? t("cultist_timer_done") : `${remPrefix} ${hh}:${mm}:${ss}`}
                        </div>
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={() => deleteTimer(tm.id)}>✕</button>
                    </div>
                  );
                })
              ) : (
                <div className="muted">{t("cultist_timers_empty")}</div>
              )}
            </div>
          </section>

          <section className="panel-section">
            <div className="pane-head">
              <h2>{t("cultist_basket_title")}</h2>
            </div>
            <ItemAutocomplete
              mode={mode}
              placeholder={t("cultist_search_ph")}
              clearOnSelect
              onSelect={handleSelectBasketItem}
            />
            <div id="cultistBasket" className="mini-list" style={{ marginTop: 10 }}>
              {basketEval && basketEval.items.length ? (
                basketEval.items.map((it, idx) => (
                  <div key={idx} className="list-row">
                    <div><b>{it.qty}× {it.name}</b> <span className="muted">(Base {fmtRub(it.unitBase, lang)})</span></div>
                    <button type="button" className="btn btn-ghost" onClick={() => removeBasketItem(idx)}>✕</button>
                  </div>
                ))
              ) : (
                <div className="muted">{t("cultist_basket_empty")}</div>
              )}
            </div>
            <div id="cultistBasketResult" className="inspector-box" style={{ marginTop: 10 }}>
              {basketEval && (
                <>
                  <div>
                    {slotsLbl} <b>{basketEval.slotsUsed} / 5</b> • Base Value:{" "}
                    <b className="num">{fmtRub(basketEval.totalBaseValue, lang)}</b> • {t("cultist_cost")}{" "}
                    <b className="num">{fmtRub(basketEval.totalCost, lang)}</b>
                  </div>
                  <div className="muted" style={{ marginTop: 4 }}>{forecastLbl} <b>{basketEval.tier}</b></div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
};
