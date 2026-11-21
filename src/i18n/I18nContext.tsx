import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DICT } from "./dict";

export type Lang = "ru" | "en";

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number | null | undefined> | null) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "ru",
  setLang: () => {},
  t: (k) => k,
});

export function translate(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number | null | undefined> | null,
): string {
  let str = DICT[lang]?.[key] ?? DICT.ru?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v ?? ""));
    }
  }
  return str;
}

export const I18nProvider: React.FC<{ initialLang?: Lang; children: React.ReactNode }> = ({
  initialLang = "ru",
  children,
}) => {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next === "en" ? "en" : "ru");
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number | null | undefined> | null) =>
      translate(lang, key, vars),
    [lang],
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
};

export function useI18n() {
  return useContext(I18nContext);
}
