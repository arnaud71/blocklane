export type Locale = 'fr' | 'en';
export type Language = Locale;
export const LANGUAGE_STORAGE_KEY = 'blocklane.language';

export function isLocale(value: unknown): value is Locale {
  return value === 'fr' || value === 'en';
}

/** Pick the first supported browser preference; never send these preferences to a server. */
export function browserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export function initialLocale(saved: unknown, languages: readonly string[]): Locale {
  return isLocale(saved) ? saved : browserLocale(languages);
}

export function languageTag(locale: Locale): 'fr-CH' | 'en-US' {
  return locale === 'fr' ? 'fr-CH' : 'en-US';
}

/** Both translations are required at the call site, including for dynamic messages. */
export function translate(locale: Locale, french: string, english: string): string {
  return locale === 'fr' ? french : english;
}
