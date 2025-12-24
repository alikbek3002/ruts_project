import React, { createContext, useContext, useMemo, useState } from "react";
import { dict, type I18nKey, type Lang } from "./i18n";

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: I18nKey) => string;
};

const STORAGE_KEY = "ruts.lang";

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "ru" || saved === "ky") return saved;
  return "ru";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readInitialLang());

  const setLang = (next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<I18nContextValue>(() => {
    return {
      lang,
      setLang,
      t: (key: I18nKey) => dict[lang][key] ?? dict.ru[key] ?? key,
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
