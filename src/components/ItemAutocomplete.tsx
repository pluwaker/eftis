import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n/I18nContext";
import { GameMode } from "../types/api";
import { fmtRub } from "../utils/format";

export interface SearchedItem {
  id: string;
  name: string;
  shortName: string;
  basePrice: number;
  fleaPrice: number;
  stashUnitRub?: number;
  iconLink?: string;
}

interface ItemAutocompleteProps {
  mode: GameMode;
  placeholder: string;
  value?: string;
  onChangeText?: (val: string) => void;
  onSelect: (item: SearchedItem) => void;
  clearOnSelect?: boolean;
}

export const ItemAutocomplete: React.FC<ItemAutocompleteProps> = ({
  mode,
  placeholder,
  value,
  onChangeText,
  onSelect,
  clearOnSelect = false,
}) => {
  const { lang } = useI18n();
  const [internalVal, setInternalVal] = useState("");
  const [results, setResults] = useState<SearchedItem[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const text = value !== undefined ? value : internalVal;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const handleChange = (next: string) => {
    if (onChangeText) onChangeText(next);
    else setInternalVal(next);

    if (timerRef.current) window.clearTimeout(timerRef.current);
    const q = next.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ items: SearchedItem[] }>(
          `/api/items/search?mode=${mode}&q=${encodeURIComponent(q)}`,
          lang,
        );
        setResults(res.items || []);
        setOpen((res.items || []).length > 0);
      } catch {
        setResults([]);
        setOpen(false);
      }
    }, 180);
  };

  return (
    <div className="autocomplete-wrap" ref={wrapRef}>
      <input
        type="search"
        className="input full"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => handleChange(e.target.value)}
      />
      {open && results.length > 0 && (
        <div className="dropdown open">
          {results.map((it) => (
            <div
              key={it.id}
              className="dropdown-item"
              onClick={() => {
                onSelect(it);
                if (clearOnSelect) {
                  if (onChangeText) onChangeText("");
                  else setInternalVal("");
                } else {
                  if (onChangeText) onChangeText(it.name);
                  else setInternalVal(it.name);
                }
                setOpen(false);
              }}
            >
              <span>
                <b>{it.name}</b>{" "}
                <span className="muted">({it.shortName})</span>
              </span>
              <span className="num muted">{fmtRub(it.stashUnitRub || it.basePrice, lang)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
