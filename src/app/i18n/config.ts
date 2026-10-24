/** UI languages. English is the source language: every key exists in `en.ts` first. */
export const LANGUAGES = ['en', 'fr', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** Name of each language in its own script (the switcher always shows these). */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
};

/** Right-to-left languages: `<html dir="rtl">`. */
export const RTL_LANGUAGES: readonly Language[] = ['ar'];

/**
 * Arabic numerals choice. `false` (default) keeps Western digits (0-9) in Arabic too, which is
 * what most Algerian/Maghrebi readers expect and keeps quantities unambiguous next to Latin
 * recipe text. Set to `true` to show Arabic-Indic digits (٠-٩) in Arabic.
 */
export const ARABIC_INDIC_DIGITS = false;

/** localStorage key mirroring the preference for guests and first paint (see index.html). */
export const LANGUAGE_STORAGE_KEY = 'mise_lang';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** First supported language in the browser's preference list, else English. */
export function detectLanguage(preferred: readonly string[] | undefined): Language {
  for (const tag of preferred ?? []) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}
