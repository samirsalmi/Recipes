import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, of } from 'rxjs';
import type { AmountParts, IngredientNames, RecipeTranslations } from '../models';
import { cacheUser, isAuthenticated, userSignal } from '../services/auth-state';
import { DisplayPrefsService } from '../services/display-prefs.service';
import { StorageService } from '../services/storage.service';
import { unitEquivalent } from '../utils/unit-equivalent';
import {
  ARABIC_INDIC_DIGITS,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  Language,
  RTL_LANGUAGES,
  detectLanguage,
  isLanguage,
} from './config';
import { DICTIONARIES, isDictionaryLoaded, loadDictionary } from './dictionaries';
import { TranslationKey } from './en';
import { ERROR_KEYS } from './errors';
import { UnitCode, unitCode } from './units';

export type Params = Record<string, string | number>;

export { DICTIONARIES };
const PLURAL_RULES: Record<Language, Intl.PluralRules> = {
  en: new Intl.PluralRules('en'),
  fr: new Intl.PluralRules('fr'),
  ar: new Intl.PluralRules('ar'),
};

/** Localized ingredient names as returned by the API (`names`); null/undefined when the
 *  ingredient dictionary does not know the ingredient. */
export type LocalizedNames = IngredientNames;

/**
 * Signal-based i18n: one `language` signal drives `t()`, number/date formatting and
 * `<html lang dir>`. The preference lives on the account (`setLanguage()` saves it with
 * PATCH /auth/me) and is mirrored in localStorage for guests and the first paint
 * (`src/index.html` reads the same key before Angular boots).
 *
 * Because `t` reads the `language` signal, every template binding using it re-renders when
 * the language changes. Plural keys are stored as `key_one`, `key_other`, ... and picked with
 * Intl.PluralRules when the params carry a numeric `count`.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private document = inject(DOCUMENT);
  // StorageService (HTTP) is resolved lazily so components using translations don't need HttpClient.
  private injector = inject(Injector);
  private prefs = inject(DisplayPrefsService);
  private languageSignal = signal<Language>(readInitialLanguage(this.document));

  readonly language = this.languageSignal.asReadonly();
  readonly dir = computed<'ltr' | 'rtl'>(() => (RTL_LANGUAGES.includes(this.language()) ? 'rtl' : 'ltr'));
  readonly isRtl = computed(() => this.dir() === 'rtl');

  constructor() {
    effect(() => {
      const root = this.document.documentElement;
      root.lang = this.language();
      root.dir = this.dir();
    });
    // The account's language wins as soon as the profile is known (login, /auth/me).
    effect(() => {
      const preferred = userSignal()?.language;
      if (preferred && isLanguage(preferred) && preferred !== untracked(this.languageSignal)) {
        this.apply(preferred);
      }
    });
  }

  /** Switches the UI language on this device (no backend call). */
  apply(language: Language): void {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // storage unavailable: the choice just won't survive a reload
    }
    if (isDictionaryLoaded(language)) {
      this.languageSignal.set(language);
    } else {
      // French/Arabic are lazy chunks: switch once the text is there (no half-English flash).
      void loadDictionary(language).then(() => {
        if (isDictionaryLoaded(language)) this.languageSignal.set(language);
      });
    }
  }

  /** The user's choice: applies it now and, when signed in, saves it on the account. */
  setLanguage(language: Language): Observable<unknown> {
    this.apply(language);
    const user = userSignal();
    if (!user || !isAuthenticated()) return of(null);
    const updated = { ...user, language };
    userSignal.set(updated);
    cacheUser(updated);
    return this.injector.get(StorageService).updateProfile({ language });
  }

  /** Translate a key. English is the fallback for anything missing in the other languages. */
  readonly t = (key: TranslationKey, params?: Params): string => this.translate(key, params);

  /** `t` for keys built at runtime (`aisle.${id}`): `fallback` is returned when no such key
   *  exists (e.g. a cuisine added to the catalog before it was translated). */
  readonly tx = (key: string, fallback = '', params?: Params): string => {
    this.language(); // track
    return this.has(key, params) ? this.translate(key, params) : fallback;
  };

  /** Whether a (dynamic) key has a translation. */
  readonly has = (key: string, params?: Params): boolean => {
    return this.lookup(this.language(), key, params) !== undefined || this.lookup(DEFAULT_LANGUAGE, key, params) !== undefined;
  };

  /** A number in the active locale (Western digits unless ARABIC_INDIC_DIGITS is on). */
  readonly n = (value: number, options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }): string =>
    new Intl.NumberFormat(this.numberLocale(), options).format(value);

  /** Re-renders the digits of an already formatted string ("1½", "250") when Arabic-Indic
   *  digits are enabled; identity otherwise. */
  readonly digits = (text: string): string => {
    if (!(ARABIC_INDIC_DIGITS && this.language() === 'ar')) return text;
    return text.replace(/[0-9]/g, d => String.fromCharCode(0x0660 + Number(d)));
  };

  /** A calendar day ("YYYY-MM-DD") formatted in the active locale (no time-zone shifts). */
  readonly day = (iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(this.numberLocale(), { ...options, timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d, 12));
  };

  /** A timestamp formatted in the active locale. */
  readonly date = (value: Date | number | string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string =>
    new Intl.DateTimeFormat(this.numberLocale(), options).format(typeof value === 'string' ? new Date(value) : value);

  /** Relative time ("5 minutes ago", "yesterday") in the active language. */
  readonly ago = (iso: string, now = Date.now()): string => {
    const rtf = new Intl.RelativeTimeFormat(this.numberLocale(), { numeric: 'auto' });
    const minutes = Math.round(Math.max(0, now - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return rtf.format(0, 'second');
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.round(hours / 24), 'day');
  };

  /** "a, b and c" in the active language. */
  readonly list = (items: string[]): string =>
    new Intl.ListFormat(this.numberLocale(), { style: 'long', type: 'conjunction' }).format(items);

  // ---- domain labels -------------------------------------------------------------------

  /** An ingredient's name in the active language: the localized dictionary name when the
   *  API gave one, otherwise exactly what the author typed. */
  readonly ingredientName = (ing: { name: string; names?: LocalizedNames | null }): string =>
    (ing.names && ing.names[this.language()]) || ing.name;

  /** Localized unit label (plural-aware); unknown units are returned as typed. */
  readonly unit = (unit: string | null | undefined, quantity: number | null = null): string => {
    const code = unitCode(unit);
    if (!code) {
      this.language(); // keep the binding reactive
      return unit ?? '';
    }
    return this.unitByCode(code, quantity !== null && quantity > 1);
  };

  readonly unitByCode = (code: UnitCode, many: boolean): string => this.translate(`unit.${code}`, { count: many ? 2 : 1 });

  /** "2 tbsp" for an already formatted number plus a (possibly unknown) unit. */
  readonly amount = (quantityText: string, unit: string | null | undefined, quantity: number | null): string => {
    const label = this.unit(unit, quantity);
    return `${this.digits(quantityText)}${label ? ' ' + label : ''}`;
  };

  /** "(30 ml)" / "(240 ml · ≈ 120 g)" for a kitchen-unit amount (display only, see `unitEquivalent`), or ''
   *  when none applies (`nowrap`: non-breaking spaces inside each part, for narrow columns) or the device preference "Show metric equivalents" is off. `canonical` is
   *  the English canonical ingredient name (enables weights for dry ingredients). */
  readonly equivalent = (quantity: number | null | undefined, unit: string | null | undefined, canonical?: string | null, nowrap = false): string => {
    this.language(); // track
    if (!this.prefs.showEquivalents()) return '';
    const eq = unitEquivalent(quantity, unit, canonical);
    if (!eq) return '';
    const sp = nowrap ? ' ' : ' '; // `nowrap`: a "≈ 28 g" never breaks across lines (narrow columns)
    const part = (v: number, u: 'ml' | 'l' | 'g' | 'kg', approx: boolean) => `${approx ? '≈' + sp : ''}${this.n(v)}${sp}${this.unitByCode(u, false)}`;
    const parts = [part(eq.value, eq.unit, eq.approx)];
    if (eq.weight) parts.push(part(eq.weight.value, eq.weight.unit, true));
    return `(${parts.join(' · ')})`;
  };

  /** Plan entries without a recipe store a plain title; the two built-in ones are translated. */
  readonly customMealTitle = (title: string | null | undefined): string => {
    if (title === 'Leftovers') return this.t('plan.leftovers');
    if (title === 'Eating out') return this.t('plan.eatingOut');
    return title || this.t('plan.meal');
  };

  /** A server-provided amount `{number, unit, many}` (grocery parts). */
  readonly amountParts = (a: AmountParts | null | undefined): string => {
    if (!a) return '';
    const code = a.unit ? unitCode(a.unit) : null;
    const label = a.unit ? (code ? this.unitByCode(code, a.many) : a.unit) : '';
    return `${this.digits(a.number)}${label ? ' ' + label : ''}`;
  };

  // ---- recipe text: author-provided translations are preferred when present --------------
  // (`recipe.translations[lang]`, an extension point: nothing in the app generates them).
  // Everything else is shown exactly as written.

  readonly recipeName = (recipe: { name: string; translations?: RecipeTranslations | null }): string =>
    recipe.translations?.[this.language()]?.name || recipe.name;

  readonly recipeDescription = (recipe: { description: string; translations?: RecipeTranslations | null }): string =>
    recipe.translations?.[this.language()]?.description || recipe.description;

  /** Step texts; a translation is used only when it has one text per step. */
  readonly recipeSteps = (recipe: { steps: { text: string }[]; translations?: RecipeTranslations | null }): string[] => {
    const translated = recipe.translations?.[this.language()]?.steps;
    return translated && translated.length === recipe.steps.length ? translated : recipe.steps.map(s => s.text);
  };

  readonly recipeTips = (recipe: { tips: string[]; translations?: RecipeTranslations | null }): string[] =>
    recipe.translations?.[this.language()]?.tips?.length ? recipe.translations![this.language()]!.tips! : recipe.tips;

  // ---- taxonomy labels (system-provided values; unknown ones fall back to the raw id) ----

  readonly meal = (id: string): string => this.tx(`meal.${id}`, id);
  readonly mealPlural = (id: string): string => this.tx(`mealPlural.${id}`, id);
  readonly diet = (id: string): string => this.tx(`diet.${id}`, id);
  readonly dietPref = (id: string): string => this.tx(`dietPref.${id}`, id);
  readonly difficulty = (id: string): string => this.tx(`difficulty.${id}`, id);
  readonly budgetLevel = (id: string): string => this.tx(`budget.${id}`, id);
  readonly aisle = (id: string): string => this.tx(`aisle.${id}`, id);
  readonly slot = (id: string): string => this.tx(`slot.${id}`, id);
  readonly slotLower = (id: string): string => this.tx(`slotLower.${id}`, id);
  readonly region = (name: string): string => this.tx(`region.${name}`, name);
  /** Cuisine names are catalog data (e.g. "Algerian"); translated when the dictionary has them. */
  readonly cuisine = (name: string): string => this.tx(`cuisine.${name}`, name);

  /** A user-facing message for a failed HTTP call: the server's `detail` mapped to a
   *  translated message when we know it, otherwise `fallback` (a key) or the generic one. */
  readonly apiError = (err: unknown, fallback: TranslationKey = 'err.generic'): string => {
    const e = err as { status?: number; error?: { detail?: unknown } } | null;
    if (e?.status === 0) return this.t('err.offline');
    const detail = e?.error?.detail;
    if (typeof detail === 'string' && ERROR_KEYS[detail]) return this.t(ERROR_KEYS[detail]);
    if (e?.status === 422) return this.t('err.invalid');
    return this.t(fallback);
  };

  // ---- internals -----------------------------------------------------------------------

  private numberLocale(): string {
    const language = this.language();
    if (language === 'ar') return ARABIC_INDIC_DIGITS ? 'ar' : 'ar-u-nu-latn';
    return language === 'en' ? 'en-GB' : language; // en-GB keeps "Wed 21" day labels
  }

  private lookup(lang: Language, key: string, params?: Params): string | undefined {
    const dict = DICTIONARIES[lang];
    const count = params?.['count'];
    if (typeof count === 'number') {
      return dict[`${key}_${PLURAL_RULES[lang].select(count)}`] ?? dict[`${key}_other`] ?? dict[key];
    }
    return dict[key];
  }

  private translate(key: string, params?: Params): string {
    const lang = this.language();
    const template = this.lookup(lang, key, params) ?? this.lookup(DEFAULT_LANGUAGE, key, params);
    if (template === undefined) return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      if (value === undefined) return match;
      return typeof value === 'number' ? this.n(value) : value;
    });
  }
}

/** The language chosen on this device (saved choice, else the browser's), before any account is known. */
export function initialLanguage(): Language {
  return readInitialLanguage(document);
}

function readInitialLanguage(document: Document): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // ignore
  }
  const nav = document.defaultView?.navigator;
  return detectLanguage(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
}
