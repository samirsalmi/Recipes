import type { Language } from './config';
import { en } from './en';

/** Loaded dictionaries. English is eager (it is the source and the fallback); French and Arabic
 *  are separate lazy chunks filled by `loadDictionary()` and stay `{}` until then (lookups fall
 *  back to English). */
export const DICTIONARIES: Record<Language, Record<string, string>> = { en, fr: {}, ar: {} };

const loaded = new Set<Language>(['en']);
const pending = new Map<Language, Promise<void>>();

export function isDictionaryLoaded(language: Language): boolean {
  return loaded.has(language);
}

/** Loads (once) the dictionary of `language`. Never rejects: on a network failure the UI just
 *  stays in English and a later call retries. */
export function loadDictionary(language: Language): Promise<void> {
  if (loaded.has(language)) return Promise.resolve();
  let promise = pending.get(language);
  if (!promise) {
    const source = language === 'fr' ? import('./fr').then(m => m.fr) : import('./ar').then(m => m.ar);
    promise = source
      .then(dict => {
        DICTIONARIES[language] = dict;
        loaded.add(language);
      })
      .catch(() => undefined)
      .finally(() => pending.delete(language));
    pending.set(language, promise);
  }
  return promise;
}

/** Loads every dictionary (used when idle after the first paint so cross-language search works). */
export function loadAllDictionaries(): Promise<void> {
  return Promise.all((['fr', 'ar'] as const).map(loadDictionary)).then(() => undefined);
}
