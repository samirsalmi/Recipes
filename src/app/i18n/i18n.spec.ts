import { TestBed } from '@angular/core/testing';
import { Pipe } from '@angular/core';
import { ActivityEvent } from '../models';
import { activityText } from './activity';
import { ar } from './ar';
import { LANGUAGE_STORAGE_KEY, detectLanguage } from './config';
import { en } from './en';
import { fr } from './fr';
import { I18nService } from './i18n.service';
import { TranslatePipe } from './translate.pipe';
import { unitCode } from './units';
import { loadAllDictionaries } from './dictionaries';
import { DisplayPrefsService } from '../services/display-prefs.service';

beforeAll(() => loadAllDictionaries());

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const bases = (dict: Record<string, string>) => new Set(Object.keys(dict).map(base));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

describe('translation dictionaries', () => {
  const dicts = { en: en as Record<string, string>, fr: fr as Record<string, string>, ar: ar as Record<string, string> };

  it('have identical key sets (plural suffixes aside)', () => {
    const reference = [...bases(dicts.en)].sort();
    expect([...bases(dicts.fr)].sort()).toEqual(reference);
    expect([...bases(dicts.ar)].sort()).toEqual(reference);
  });

  it('have no empty values', () => {
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('give every plural key an _other fallback and never mix plural and plain forms', () => {
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const key of Object.keys(dict)) {
        if (PLURAL.test(key)) {
          expect(dict[`${base(key)}_other`], `${lang}:${base(key)}`).toBeTruthy();
          expect(dict[base(key)], `${lang}:${base(key)} has both forms`).toBeUndefined();
        }
      }
    }
  });

  it('use the same {placeholders} in every language', () => {
    for (const key of Object.keys(dicts.en)) {
      for (const lang of ['fr', 'ar'] as const) {
        const translated = dicts[lang][key] ?? dicts[lang][`${base(key)}_other`];
        // Arabic singular/dual forms may drop {count} ("حصة واحدة"); every other placeholder must stay.
        const strip = (s: string) => placeholders(s).split(',').filter(p => p !== 'count').join(',');
        expect(strip(translated), `${lang}:${key}`).toBe(strip(dicts.en[key]));
      }
    }
  });

  it('keep Arabic plural keys within the Intl.PluralRules categories', () => {
    const categories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
    for (const key of Object.keys(ar)) {
      const m = key.match(PLURAL);
      if (m) expect(categories.has(m[1])).toBe(true);
    }
  });
});

describe('detectLanguage', () => {
  it('picks the first supported browser language and falls back to English', () => {
    expect(detectLanguage(['fr-CA', 'en'])).toBe('fr');
    expect(detectLanguage(['ar-DZ'])).toBe('ar');
    expect(detectLanguage(['de-DE', 'ar'])).toBe('ar');
    expect(detectLanguage(['de-DE'])).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });
});

describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    TestBed.configureTestingModule({});
    i18n = TestBed.inject(I18nService);
    i18n.apply('en');
  });

  afterEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    document.documentElement.removeAttribute('dir');
    document.documentElement.lang = 'en';
  });

  it('translates with params and falls back to the key', () => {
    expect(i18n.t('nav.discover')).toBe('Discover');
    expect(i18n.t('timers.step', { n: 2, text: '10 min' })).toBe('Step 2: 10 min');
    i18n.apply('fr');
    expect(i18n.t('nav.discover')).toBe('Découvrir');
    expect(i18n.t('timers.step', { n: 2, text: '10 min' })).toBe('Étape 2 : 10 min');
    expect(i18n.tx('cuisine.Nowhere', 'Nowhere')).toBe('Nowhere');
    expect(i18n.tx('cuisine.Algerian', 'x')).toBe('Algérienne');
  });

  it('handles plurals with Intl.PluralRules, including the Arabic categories', () => {
    expect(i18n.t('common.servings', { count: 1 })).toBe('1 serving');
    expect(i18n.t('common.servings', { count: 4 })).toBe('4 servings');
    i18n.apply('fr');
    expect(i18n.t('common.servings', { count: 0 })).toBe('0 portion'); // French: 0 and 1 are singular
    expect(i18n.t('common.servings', { count: 2 })).toBe('2 portions');
    i18n.apply('ar');
    expect(i18n.t('common.servings', { count: 1 })).toBe('حصة واحدة');
    expect(i18n.t('common.servings', { count: 2 })).toBe('حصتان');
    expect(i18n.t('common.servings', { count: 3 })).toBe('3 حصص');
    expect(i18n.t('common.servings', { count: 11 })).toBe('11 حصة');
    expect(i18n.t('common.servings', { count: 100 })).toBe('100 حصة');
    expect(i18n.t('common.servings', { count: 0 })).toBe('لا حصص');
  });

  it('sets <html lang> and dir reactively, RTL for Arabic only', () => {
    i18n.apply('ar');
    TestBed.tick();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(i18n.isRtl()).toBe(true);
    i18n.apply('fr');
    TestBed.tick();
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(i18n.dir()).toBe('ltr');
  });

  it('mirrors the choice in localStorage for guests and first paint', () => {
    i18n.apply('ar');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
  });

  it('uses Western digits in Arabic by default', () => {
    i18n.apply('ar');
    expect(i18n.n(1234)).toMatch(/1.?234/);
    expect(i18n.digits('1½')).toBe('1½');
    expect(i18n.day('2026-10-21', { day: 'numeric' })).toBe('21');
  });

  it('formats day labels per language', () => {
    expect(i18n.day('2026-10-21')).toBe('Wed 21');
    i18n.apply('fr');
    expect(i18n.day('2026-10-21')).toMatch(/mer\.? 21/);
  });

  describe('ingredient and unit localization', () => {
    const butter = { name: 'beurre', names: { en: 'butter', fr: 'beurre', ar: 'زبدة' } };

    it('shows the dictionary name in the active language, the typed name otherwise', () => {
      expect(i18n.ingredientName(butter)).toBe('butter');
      i18n.apply('fr');
      expect(i18n.ingredientName({ name: 'butter', names: butter.names })).toBe('beurre');
      i18n.apply('ar');
      expect(i18n.ingredientName(butter)).toBe('زبدة');
      expect(i18n.ingredientName({ name: 'zorblax', names: null })).toBe('zorblax');
      expect(i18n.ingredientName({ name: 'zorblax' })).toBe('zorblax');
    });

    it('shows French-typed dairy in the reader language (fromage, crème liquide)', () => {
      const cheese = { name: 'fromage', names: { en: 'cheese', fr: 'fromage', ar: 'جبن' } };
      const cream = { name: 'crème liquide', names: { en: 'cream', fr: 'crème liquide', ar: 'كريمة سائلة' } };
      expect(i18n.ingredientName(cheese)).toBe('cheese');
      expect(i18n.ingredientName(cream)).toBe('cream');
      i18n.apply('fr');
      expect(i18n.ingredientName(cheese)).toBe('fromage');
      expect(i18n.ingredientName(cream)).toBe('crème liquide');
      i18n.apply('ar');
      expect(i18n.ingredientName(cheese)).toBe('جبن');
      expect(i18n.ingredientName(cream)).toBe('كريمة سائلة');
    });

    it('translates units, with plural forms, and passes unknown units through', () => {
      expect(i18n.unit('tbsp', 2)).toBe('tbsp');
      expect(i18n.unit('cloves', 2)).toBe('cloves');
      expect(i18n.unit('clove', 1)).toBe('clove');
      i18n.apply('fr');
      expect(i18n.unit('tbsp', 2)).toBe('c. à s.');
      expect(i18n.unit('cloves', 3)).toBe('gousses');
      expect(i18n.unit('clove', 1)).toBe('gousse');
      i18n.apply('ar');
      expect(i18n.unit('tbsp', 2)).toBe('ملاعق كبيرة');
      expect(i18n.unit('tbsp', 1)).toBe('ملعقة كبيرة');
      expect(i18n.unit('g', 250)).toBe('غ');
      expect(i18n.unit('florps', 2)).toBe('florps');
    });

    it('renders quantity + unit and server amounts', () => {
      i18n.apply('fr');
      expect(i18n.amount('2', 'tbsp', 2)).toBe('2 c. à s.');
      expect(i18n.amountParts({ number: '2', unit: 'clove', many: true })).toBe('2 gousses');
      expect(i18n.amountParts({ number: '500', unit: 'g', many: false })).toBe('500 g');
      expect(i18n.amountParts({ number: '3', unit: null, many: true })).toBe('3');
      expect(i18n.amountParts(null)).toBe('');
    });
  });

  it('maps API errors to translated messages', () => {
    expect(i18n.apiError({ status: 409, error: { detail: 'Username already taken' } })).toBe('That username is already taken.');
    expect(i18n.apiError({ status: 0 })).toBe('No connection. Check your internet and try again.');
    i18n.apply('ar');
    expect(i18n.apiError({ status: 401, error: { detail: 'Invalid username or password' } })).toBe('اسم المستخدم أو كلمة المرور غير صحيحة.');
    expect(i18n.apiError({ status: 500 }, 'detail.couldNotDelete')).toBe('تعذّر حذف الوصفة.');
    expect(i18n.apiError({ status: 422 })).toBe('يُرجى مراجعة الحقول والمحاولة مجددًا.');
  });

  it('prefers author-provided recipe translations when present', () => {
    const recipe = { name: 'Soup', description: 'Warm', steps: [{ text: 'Boil.' }], tips: ['Salt'], translations: { fr: { name: 'Soupe', steps: ['Faire bouillir.'] } } };
    expect(i18n.recipeName(recipe)).toBe('Soup');
    i18n.apply('fr');
    expect(i18n.recipeName(recipe)).toBe('Soupe');
    expect(i18n.recipeDescription(recipe)).toBe('Warm');
    expect(i18n.recipeSteps(recipe)).toEqual(['Faire bouillir.']);
    expect(i18n.recipeTips(recipe)).toEqual(['Salt']);
    // A translation with the wrong number of steps is ignored rather than shown misaligned.
    expect(i18n.recipeSteps({ ...recipe, steps: [{ text: 'a' }, { text: 'b' }] })).toEqual(['a', 'b']);
    i18n.apply('ar');
    expect(i18n.recipeName(recipe)).toBe('Soup');
  });

  it('translates the built-in custom meal titles only', () => {
    i18n.apply('fr');
    expect(i18n.customMealTitle('Leftovers')).toBe('Restes');
    expect(i18n.customMealTitle('Pizza night')).toBe('Pizza night');
    expect(i18n.customMealTitle(null)).toBe('Repas');
  });

  it('formats relative times in the active language', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(i18n.ago('2026-10-20T11:45:00Z', now)).toBe('15 minutes ago');
    i18n.apply('fr');
    expect(i18n.ago('2026-10-20T11:45:00Z', now)).toBe('il y a 15 minutes');
  });
});

describe('unitCode', () => {
  it('recognises English, French and Arabic spellings', () => {
    expect(unitCode('Tablespoons')).toBe('tbsp');
    expect(unitCode('c. à s.')).toBe('tbsp');
    expect(unitCode('ملعقة كبيرة')).toBe('tbsp');
    expect(unitCode('gousses')).toBe('clove');
    expect(unitCode('كوب')).toBe('cup');
    expect(unitCode('bananas')).toBeNull();
    expect(unitCode(null)).toBeNull();
  });
});

describe('TranslatePipe', () => {
  it('translates a key and follows the language', () => {
    TestBed.configureTestingModule({});
    const i18n = TestBed.inject(I18nService);
    const pipe = TestBed.runInInjectionContext(() => new TranslatePipe());
    i18n.apply('en');
    expect(pipe.transform('common.save')).toBe('Save');
    i18n.apply('fr');
    expect(pipe.transform('common.save')).toBe('Enregistrer');
    i18n.apply('en');
  });
});

describe('activityText', () => {
  const ev = (type: string, payload: ActivityEvent['payload']): ActivityEvent => ({ id: 1, type, payload, userId: 2, userName: 'Amina', createdAt: '2026-10-20T10:00:00Z' });

  it('rebuilds the sentence in the active language from structured payloads', () => {
    const i18n = TestBed.inject(I18nService);
    i18n.apply('en');
    const add = ev('plan.add', { title: 'Shakshuka', date: '2026-10-21', slot: 'dinner', summary: 'added Shakshuka to Wed 21 dinner' });
    expect(activityText(add, i18n)).toBe('added Shakshuka to Wed 21 dinner');
    i18n.apply('fr');
    expect(activityText(add, i18n)).toMatch(/^a ajouté Shakshuka à mer\.? 21 \(dîner\)$/);
    i18n.apply('ar');
    expect(activityText(ev('groceries.mark', { key: 'butter', names: { en: 'butter', fr: 'beurre', ar: 'زبدة' } }), i18n)).toBe('اشترى زبدة');
    // Old events without structured fields keep the server's summary.
    expect(activityText(ev('plan.add', { summary: 'added X' }), i18n)).toBe('added X');
    i18n.apply('en');
  });
});

// Keeps the unused-import linter quiet if Pipe types are tree-shaken in the test build.
void Pipe;

describe('I18nService.equivalent', () => {
  let svc: I18nService;
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(I18nService);
  });
  afterEach(() => localStorage.clear());

  it('formats in en / fr / ar with the localized unit labels and the approx sign', async () => {
    expect(svc.equivalent(2, 'tbsp')).toBe('(30 ml)');
    expect(svc.equivalent(1, 'cup', 'flour')).toBe('(240 ml · ≈ 120 g)');
    expect(svc.equivalent(2, 'tbsp', 'butter')).toBe('(30 ml · ≈ 28 g)');
    expect(svc.equivalent(1, 'small cup')).toBe('(120 ml)');
    expect(svc.equivalent(5, 'cup')).toBe('(1.2 L)');
    await svc.setLanguage('fr');
    expect(svc.equivalent(1, 'cup', 'flour')).toBe('(240 ml · ≈ 120 g)');
    expect(svc.equivalent(5, 'cup')).toBe('(1,2 L)');
    expect(svc.equivalent(1.5, 'tsp')).toBe('(7,5 ml)');
    await svc.setLanguage('ar');
    expect(svc.equivalent(2, 'tbsp')).toBe('(30 مل)');
    expect(svc.equivalent(1, 'cup', 'flour')).toBe('(240 مل · ≈ 120 غ)');
  });

  it('can keep each part on one line', () => {
    expect(svc.equivalent(2, 'tbsp', 'butter', true)).toBe('(30 ml · ≈ 28 g)');
  });

  it('is empty when nothing applies or the device toggle is off', () => {
    expect(svc.equivalent(2, 'g')).toBe('');
    expect(svc.equivalent(2, 'clove')).toBe('');
    TestBed.inject(DisplayPrefsService).setShowEquivalents(false);
    expect(svc.equivalent(2, 'tbsp')).toBe('');
    expect(localStorage.getItem('mise_equiv')).toBe('0');
  });
});
