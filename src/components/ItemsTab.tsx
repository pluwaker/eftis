import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n/I18nContext";
import { GameMode } from "../types/api";
import { ItemAutocomplete, SearchedItem } from "./ItemAutocomplete";

interface TrackedItem {
  id: number;
  name: string;
  shortName?: string;
  iconLink?: string;
  currentQty: number;
  targetQty: number;
  categoryTag: string;
  firOnly: boolean;
  notes?: string;
  done: boolean;
}

interface CounterSummary {
  totalItems: number;
  completedItems: number;
  activeItems: number;
  totalUnitsCurrent: number;
  totalUnitsTarget: number;
  pctComplete: number;
}

interface ItemsTabProps {
  active: boolean;
  mode: GameMode;
  dataRev: number;
  onToast: (msg: string) => void;
}

export const ItemsTab: React.FC<ItemsTabProps> = ({ active, mode, dataRev, onToast }) => {
  const { lang, t } = useI18n();
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [summary, setSummary] = useState<CounterSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [itemName, setItemName] = useState("");
  const [selectedItem, setSelectedItem] = useState<SearchedItem | null>(null);
  const [targetQty, setTargetQty] = useState(1);
  const [categoryTag, setCategoryTag] = useState("quest");
  const [firOnly, setFirOnly] = useState(false);
  const [notes, setNotes] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadCounter = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: TrackedItem[]; summary: CounterSummary }>(
        `/api/item-counter?mode=${mode}`,
        lang,
      );
      setItems(data.items || []);
      setSummary(data.summary || null);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mode, lang, onToast]);

  useEffect(() => {
    if (active) void loadCounter();
  }, [active, mode, lang, dataRev, loadCounter]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = itemName.trim();
    if (!trimmed) {
      onToast(lang === "en" ? "Enter an item name" : "Введите название предмета");
      return;
    }
    try {
      const res = await apiFetch<{ items: TrackedItem[]; summary: CounterSummary }>("/api/item-counter", lang, {
        method: "POST",
        body: JSON.stringify({
          mode,
          itemId: selectedItem?.id || "",
          name: trimmed,
          targetQty: Math.max(1, targetQty),
          categoryTag,
          firOnly,
          notes: notes.trim(),
        }),
      });
      setItems(res.items || []);
      setSummary(res.summary || null);
      setItemName("");
      setSelectedItem(null);
      setTargetQty(1);
      setNotes("");
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleImportQuests = async () => {
    try {
      const res = await apiFetch<{ items: TrackedItem[]; summary: CounterSummary; imported?: number }>(
        "/api/item-counter/import-quests",
        lang,
        { method: "POST", body: JSON.stringify({ mode }) },
      );
      setItems(res.items || []);
      setSummary(res.summary || null);
      onToast(
        lang === "en"
          ? `Imported quest items: ${res.imported || 0}`
          : `Импортировано предметов из квестов: ${res.imported || 0}`,
      );
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const handleClearCompleted = async () => {
    try {
      const res = await apiFetch<{ items: TrackedItem[]; summary: CounterSummary }>(
        "/api/item-counter/clear-completed",
        lang,
        { method: "POST", body: JSON.stringify({ mode }) },
      );
      setItems(res.items || []);
      setSummary(res.summary || null);
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const patchItem = async (id: number, payload: Record<string, unknown>) => {
    try {
      const res = await apiFetch<{ items: TrackedItem[]; summary: CounterSummary }>(
        "/api/item-counter/adjust",
        lang,
        { method: "POST", body: JSON.stringify({ mode, id, ...payload }) },
      );
      setItems(res.items || []);
      setSummary(res.summary || null);
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const deleteItem = async (id: number) => {
    try {
      const res = await apiFetch<{ items: TrackedItem[]; summary: CounterSummary }>(
        `/api/item-counter/${id}?mode=${mode}`,
        lang,
        { method: "DELETE" },
      );
      setItems(res.items || []);
      setSummary(res.summary || null);
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  const getCategoryMeta = (tag: string): [string, string] => {
    const map: Record<string, [string, string]> = {
      quest: [t("items_cat_quest"), "amber"],
      hideout: [t("items_cat_hideout"), ""],
      barter: [t("items_cat_barter"), ""],
      keys: [t("items_cat_keys"), "green"],
      general: [t("items_cat_general"), ""],
    };
    return map[tag] || [t("items_cat_general"), ""];
  };

  const s = summary || {
    totalItems: 0,
    completedItems: 0,
    activeItems: 0,
    totalUnitsCurrent: 0,
    totalUnitsTarget: 0,
    pctComplete: 0,
  };

  const q = searchQuery.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (categoryFilter !== "all" && it.categoryTag !== categoryFilter) return false;
    if (statusFilter === "active" && it.done) return false;
    if (statusFilter === "done" && !it.done) return false;
    if (
      q &&
      !(it.name || "").toLowerCase().includes(q) &&
      !(it.shortName || "").toLowerCase().includes(q) &&
      !(it.notes || "").toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });

  return (
    <section className={`tab-panel${active ? " active" : ""}`} id="tab-items">
      <header className="view-header">
        <div className="view-header-title">
          <h1>{t("items_title")}</h1>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary" onClick={handleImportQuests}>
            {t("items_btn_import")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleClearCompleted}>
            {t("items_btn_clear_done")}
          </button>
        </div>
      </header>

      <div className="telemetry-strip" id="itemCounterKpis">
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("items_kpi_total")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value">{s.totalItems}</div>
            <div className="telemetry-delta">{t("items_kpi_left")}: {s.activeItems}</div>
          </div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("items_kpi_done")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value">{s.completedItems}</div>
            <div className="telemetry-delta">/ {s.totalItems}</div>
          </div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("items_kpi_units")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value accent">
              {s.totalUnitsCurrent} <span className="muted" style={{ fontSize: 15 }}>/ {s.totalUnitsTarget}</span>
            </div>
          </div>
        </div>
        <div className="telemetry-cell">
          <div className="telemetry-label">{t("items_kpi_pct")}</div>
          <div className="telemetry-row">
            <div className="telemetry-value accent">{s.pctComplete}%</div>
          </div>
          <div className="kpi-bar"><div className="kpi-bar-fill" style={{ width: `${Math.min(100, s.pctComplete)}%` }} /></div>
        </div>
      </div>

      <div className="panel-section" style={{ marginBottom: 16 }}>
        <div className="pane-head">
          <h2>{t("items_add_title")}</h2>
          <div className="qty-preset-pills">
            <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>{t("items_goal_lbl")}</span>
            {[1, 2, 3, 5, 10, 15].map((qVal) => (
              <button key={qVal} type="button" className="qty-pill" onClick={() => setTargetQty(qVal)}>
                {qVal}
              </button>
            ))}
          </div>
        </div>
        <form className="counter-add-grid" onSubmit={handleAdd}>
          <div className="field counter-add-name">
            <label>{t("items_search_lbl")}</label>
            <ItemAutocomplete
              mode={mode}
              placeholder={t("items_search_ph")}
              value={itemName}
              onChangeText={(val) => {
                setItemName(val);
                if (selectedItem && selectedItem.name !== val) setSelectedItem(null);
              }}
              onSelect={(it) => {
                setSelectedItem(it);
                setItemName(it.name);
              }}
            />
          </div>
          <div className="field">
            <label>{t("items_tgt_lbl")}</label>
            <input
              type="number"
              className="input num"
              min={1}
              value={targetQty}
              onChange={(e) => setTargetQty(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="field">
            <label>{t("items_cat_lbl")}</label>
            <select className="select full" value={categoryTag} onChange={(e) => setCategoryTag(e.target.value)}>
              <option value="quest">{t("items_cat_quest")}</option>
              <option value="hideout">{t("items_cat_hideout")}</option>
              <option value="barter">{t("items_cat_barter")}</option>
              <option value="keys">{t("items_cat_keys")}</option>
              <option value="general">{t("items_cat_general")}</option>
            </select>
          </div>
          <div className="field counter-add-note">
            <label>{t("items_note_lbl")}</label>
            <input
              type="text"
              className="input full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("items_note_ph")}
            />
          </div>
          <div className="counter-add-actions">
            <label className="check-item">
              <input type="checkbox" checked={firOnly} onChange={(e) => setFirOnly(e.target.checked)} />
              <span>{t("items_fir_only")}</span>
            </label>
            <button type="submit" className="btn btn-primary">{t("items_btn_add")}</button>
          </div>
        </form>
      </div>

      <section className="ledger-section">
        <div className="filters-bar counter-filter-bar">
          <input
            type="search"
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("items_filter_ph")}
          />
          <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">{t("items_cat_all")}</option>
            <option value="quest">{t("items_cat_quest")}</option>
            <option value="hideout">{t("items_cat_hideout")}</option>
            <option value="barter">{t("items_cat_barter")}</option>
            <option value="keys">{t("items_cat_keys")}</option>
            <option value="general">{t("items_cat_general")}</option>
          </select>
          <div className="subtabs compact">
            <button type="button" className={`subtab-btn${statusFilter === "all" ? " active" : ""}`} onClick={() => setStatusFilter("all")}>
              {t("items_st_all")}
            </button>
            <button type="button" className={`subtab-btn${statusFilter === "active" ? " active" : ""}`} onClick={() => setStatusFilter("active")}>
              {t("items_st_active")}
            </button>
            <button type="button" className={`subtab-btn${statusFilter === "done" ? " active" : ""}`} onClick={() => setStatusFilter("done")}>
              {t("items_st_done")}
            </button>
          </div>
          <span className="muted result-meta num">
            {lang === "en" ? `${filtered.length} of ${items.length}` : `${filtered.length} из ${items.length}`}
          </span>
        </div>

        <div id="itemCounterList" className="counter-cards-grid">
          {loading && !items.length ? (
            <div className="muted">{lang === "en" ? "Loading item counter..." : "Загрузка счётчика предметов..."}</div>
          ) : !filtered.length ? (
            <div className="panel-section" style={{ gridColumn: "1 / -1" }}>
              <div className="muted">{items.length ? t("items_empty_filter") : t("items_empty")}</div>
            </div>
          ) : (
            filtered.map((it) => {
              const cur = Math.max(0, Number(it.currentQty || 0));
              const tgt = Math.max(1, Number(it.targetQty || 1));
              const pct = Math.min(100, Math.round((cur / tgt) * 100));
              const [catLabel, catCls] = getCategoryMeta(it.categoryTag);
              const abbr = (it.shortName || it.name || "?").slice(0, 4).toUpperCase();
              return (
                <article key={it.id} className={`counter-card${it.done ? " is-done" : ""}`}>
                  <div className="counter-card-head">
                    <div className="counter-item-thumb">
                      {it.iconLink ? <img src={it.iconLink} alt="" loading="lazy" /> : <span>{abbr}</span>}
                    </div>
                    <div className="counter-card-info">
                      <div className="counter-card-title">{it.name}</div>
                      <div className="counter-card-badges">
                        <span className={`badge ${catCls}`}>{catLabel}</span>
                        {it.firOnly && <span className="badge amber">FIR</span>}
                        {it.done && <span className="badge green">{t("items_st_done")}</span>}
                      </div>
                      {it.notes && <div className="counter-card-note">{it.notes}</div>}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      title={t("items_btn_del")}
                      style={{ padding: "2px 6px" }}
                      onClick={() => deleteItem(it.id)}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="counter-progress-row">
                    <div className="counter-progress-track">
                      <div className="counter-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="counter-ratio-label">{cur} / {tgt} ({pct}%)</span>
                  </div>

                  <div className="counter-controls">
                    <button type="button" className="counter-step-btn" onClick={() => patchItem(it.id, { delta: -5 })}>−5</button>
                    <button type="button" className="counter-step-btn" onClick={() => patchItem(it.id, { delta: -1 })}>−1</button>
                    <div className="counter-direct-pair">
                      <input
                        type="number"
                        className="counter-num-input counter-qty-input"
                        min={0}
                        value={cur}
                        aria-label={t("items_cur_lbl")}
                        onChange={(e) => patchItem(it.id, { currentQty: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      <span className="muted">/</span>
                      <input
                        type="number"
                        className="counter-num-input counter-target-input"
                        min={1}
                        value={tgt}
                        aria-label={t("items_tgt_lbl")}
                        onChange={(e) => patchItem(it.id, { targetQty: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </div>
                    <button type="button" className="counter-step-btn plus" onClick={() => patchItem(it.id, { delta: 1 })}>+1</button>
                    <button type="button" className="counter-step-btn plus" onClick={() => patchItem(it.id, { delta: 5 })}>+5</button>
                    <button
                      type="button"
                      className="counter-step-btn done-btn"
                      onClick={() => patchItem(it.id, { currentQty: it.done ? 0 : tgt })}
                    >
                      {it.done ? "↺ 0" : `✓ ${t("items_st_all")}`}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </section>
  );
};
