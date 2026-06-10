import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Lang, TranslationKey, translations } from "./translations";

interface LangContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LangContext = createContext<LangContextType>({
  lang: "fr",
  setLang: () => {},
  t: (key) => key,
});

const STORAGE_KEY = "maria_lang";

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && ["fr", "en", "es"].includes(saved)) return saved;
    const browser = navigator.language.slice(0, 2).toLowerCase();
    if (browser === "es") return "es";
    if (browser === "fr") return "fr";
    return "en";
  } catch {
    return "fr";
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");

  useEffect(() => {
    setLangState(detectLang());
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }

  function t(key: TranslationKey): string {
    return translations[lang][key] ?? translations.fr[key] ?? key;
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
