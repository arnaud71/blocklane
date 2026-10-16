import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { initialLocale, isLocale, LANGUAGE_STORAGE_KEY, translate, type Locale } from './locale';

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (french: string, english: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: 'fr',
  setLocale: () => {},
  t: (french) => french,
});

function readInitialLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    /* A blocked store does not block the interface. */
  }
  return initialLocale(
    saved,
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(readInitialLocale);
  const context = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale(next) {
        if (!isLocale(next)) return;
        updateLocale(next);
        try {
          window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
        } catch {
          /* Selection still works for this session. */
        }
      },
      t: (french, english) => translate(locale, french, english),
    }),
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(
      locale,
      'BlockLane · Observatoire blockchain',
      'BlockLane · Blockchain observatory',
    );
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        translate(
          locale,
          'BlockLane — un observatoire visuel de Bitcoin et Ethereum. Comprendre les transactions, les frais et les blocs, avec une perspective HEG.',
          'BlockLane — a visual Bitcoin and Ethereum observatory. Explore transactions, fees and blocks through an optional HEG identity.',
        ),
      );
  }, [locale]);
  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  return useContext(LanguageContext);
}
