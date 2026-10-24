import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { loadAllDictionaries } from '../../i18n/dictionaries';
import { I18nService } from '../../i18n/i18n.service';
import { IngredientCheck, IngredientSuggestion } from '../../models';
import { StorageService } from '../../services/storage.service';
import { IngredientFieldComponent } from './ingredient-field.component';

beforeAll(() => loadAllDictionaries());

const CHEESE_NAMES = { en: 'cheese', fr: 'fromage', ar: 'جبن' };

function suggestion(name: string, over: Partial<IngredientSuggestion> = {}): IngredientSuggestion {
  return { canonical: 'cheese', name, matched: null, names: CHEESE_NAMES, aisle: 'dairy-eggs', known: true, custom: false, match: 'prefix', ...over };
}

function check(name: string, over: Partial<IngredientCheck> = {}): IngredientCheck {
  return { name, canonical: 'cheese', known: true, aisle: 'dairy-eggs', remembered: false, names: CHEESE_NAMES, exact: true, languages: ['fr', 'en'], ...over };
}

describe('IngredientFieldComponent', () => {
  let storage: { suggestIngredients: ReturnType<typeof vi.fn>; checkIngredients: ReturnType<typeof vi.fn> };

  function setup(text = '', lang: 'en' | 'fr' | 'ar' = 'en') {
    storage = {
      suggestIngredients: vi.fn(() => of([suggestion('cheese', { matched: 'fromage', match: 'exact' }), suggestion('feta', { canonical: 'feta', matched: 'fromage feta' })])),
      checkIngredients: vi.fn((names: string[]) =>
        of(names.map(n => {
          if (n === 'fromage') return check(n);
          if (n === 'cheese') return check(n, { languages: ['en'] });
          return check(n, { known: false, exact: false, names: null });
        }))),
    };
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
    TestBed.inject(I18nService).setLanguage(lang);
    const fixture = TestBed.createComponent(IngredientFieldComponent);
    fixture.componentRef.setInput('text', text);
    fixture.detectChanges();
    return fixture;
  }

  const ta = (f: ReturnType<typeof setup>) => f.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  const options = (f: ReturnType<typeof setup>, qa = 'ingredient-suggestion') => [...f.nativeElement.querySelectorAll(`[data-qa="${qa}"]`)] as HTMLElement[];

  async function type(f: ReturnType<typeof setup>, value: string) {
    const el = ta(f);
    el.focus();
    el.value = value;
    el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(200);
    f.detectChanges();
  }

  const key = (f: ReturnType<typeof setup>, k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    ta(f).dispatchEvent(e);
    f.detectChanges();
    return e;
  };

  async function leave(f: ReturnType<typeof setup>) {
    ta(f).dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(10);
    f.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows ARIA combobox suggestions after a pause, with the matched alias and 44px rows', async () => {
    const f = setup();
    await type(f, 'fromage');
    expect(storage.suggestIngredients).toHaveBeenCalledTimes(1);
    expect(storage.suggestIngredients).toHaveBeenCalledWith('fromage', 'en', 6);
    const list = f.nativeElement.querySelector('[data-qa="ingredient-suggest"]') as HTMLElement;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(ta(f).getAttribute('role')).toBe('combobox');
    expect(ta(f).getAttribute('aria-expanded')).toBe('true');
    const rows = options(f);
    expect(rows.map(r => r.getAttribute('role'))).toEqual(['option', 'option']);
    expect(rows[0].textContent).toContain('cheese');
    expect(rows[0].textContent).toContain('fromage');
    expect(rows[0].className).toContain('min-h-[44px]');
  });

  it('debounces: one request for a burst of typing, none for one character', async () => {
    const f = setup();
    await type(f, 'f');
    expect(storage.suggestIngredients).not.toHaveBeenCalled();
    for (const v of ['fr', 'fro', 'from']) {
      const el = ta(f);
      el.value = v;
      el.setSelectionRange(v.length, v.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(40);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(storage.suggestIngredients).toHaveBeenCalledTimes(1);
    expect(storage.suggestIngredients).toHaveBeenCalledWith('from', 'en', 6);
  });

  it('is keyboard navigable: arrows move, Enter takes the highlighted one, Escape closes', async () => {
    const f = setup();
    await type(f, 'fromage');
    expect(key(f, 'ArrowDown').defaultPrevented).toBe(true);
    const first = options(f)[0];
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(ta(f).getAttribute('aria-activedescendant')).toBe(first.id);
    key(f, 'ArrowDown');
    expect(options(f)[1].getAttribute('aria-selected')).toBe('true');
    key(f, 'ArrowUp');
    key(f, 'ArrowUp'); // wraps to the last
    expect(options(f)[1].getAttribute('aria-selected')).toBe('true');
    key(f, 'ArrowDown'); // back to the first
    expect(key(f, 'Enter').defaultPrevented).toBe(true);
    expect(f.componentInstance.text()).toBe('cheese');
    expect(options(f).length).toBe(0);

    await type(f, 'cheese\nfromage');
    expect(options(f).length).toBe(2);
    expect(key(f, 'Escape').defaultPrevented).toBe(true);
    expect(options(f).length).toBe(0);
  });

  it('a plain Enter (nothing highlighted) stays a line break', async () => {
    const f = setup();
    await type(f, 'fromage');
    expect(key(f, 'Enter').defaultPrevented).toBe(false);
  });

  it('accepting a suggestion keeps the quantity, unit and French "de"', async () => {
    const f = setup();
    storage.suggestIngredients.mockReturnValue(of([suggestion('flour', { canonical: 'flour', matched: 'farine' })]));
    await type(f, '250 g de far');
    options(f)[0].click();
    f.detectChanges();
    expect(f.componentInstance.text()).toBe('250 g flour');
  });

  it('suggests units after the quantity and completes them in the reader language', async () => {
    const f = setup();
    await type(f, '2 tab');
    const units = options(f, 'unit-suggest');
    expect(units.length).toBeGreaterThan(0);
    expect(units[0].textContent).toContain('tbsp');
    units[0].click();
    f.detectChanges();
    expect(f.componentInstance.text()).toBe('2 tbsp ');
  });

  it('completes units in French and Arabic readers', async () => {
    const fr = setup('', 'fr');
    await type(fr, '2 tab');
    options(fr, 'unit-suggest')[0].click();
    expect(fr.componentInstance.text()).toBe('2 c. à s. ');
    TestBed.resetTestingModule();
    const ar = setup('', 'ar');
    await type(ar, '2 tab');
    options(ar, 'unit-suggest')[0].click();
    expect(ar.componentInstance.text()).toBe('2 ملاعق كبيرة ');
  });

  it('on leaving the field, an exactly matched foreign name is rewritten to the reader language, quantity and unit intact', async () => {
    const f = setup();
    await type(f, '2 table spoon fromage');
    await leave(f);
    expect(f.componentInstance.text()).toBe('2 tbsp cheese');
    const was = f.nativeElement.querySelectorAll('[data-qa="ingredient-was"]');
    expect(was.length).toBe(2); // unit and name
    expect(f.nativeElement.querySelector('[data-qa="ingredient-preview"]').textContent).toContain('was: fromage');
  });

  it('writes "cheese" as "fromage" for a French reader and keeps the particle rule', async () => {
    const f = setup('', 'fr');
    await type(f, '200 g cheese');
    await leave(f);
    expect(f.componentInstance.text()).toBe('200 g de fromage');
  });

  it('never rewrites fuzzy or unknown names, or names already in the reader language', async () => {
    const f = setup();
    storage.checkIngredients.mockReturnValue(of([check('fromagge', { exact: false })]));
    await type(f, '1 fromagge');
    await leave(f);
    expect(f.componentInstance.text()).toBe('1 fromagge');
    storage.checkIngredients.mockReturnValue(of([check('cheese', { languages: ['en'] })]));
    await type(f, '1 cheese');
    await leave(f);
    expect(f.componentInstance.text()).toBe('1 cheese');
  });

  it('Undo puts the original back and it is left alone afterwards; retyping it is respected too', async () => {
    const f = setup();
    await type(f, '2 fromage');
    await leave(f);
    expect(f.componentInstance.text()).toBe('2 cheese');
    (f.nativeElement.querySelector('[data-qa="ingredient-was"]') as HTMLElement).click();
    f.detectChanges();
    expect(f.componentInstance.text()).toBe('2 fromage');
    await leave(f);
    expect(f.componentInstance.text()).toBe('2 fromage');

    // a second line: rewritten once, then typed back by hand -> never rewritten again
    await type(f, '2 fromage\n3 beurre');
    storage.checkIngredients.mockReturnValue(of([check('beurre', { canonical: 'butter', names: { en: 'butter', fr: 'beurre', ar: 'زبدة' } })]));
    await leave(f);
    expect(f.componentInstance.text()).toBe('2 fromage\n3 butter');
    await type(f, '2 fromage\n3 beurre');
    await leave(f);
    expect(f.componentInstance.text()).toBe('2 fromage\n3 beurre');
  });

  it('Enter tidies the finished line and pasting a multi-line list tidies every line', async () => {
    const f = setup();
    await type(f, '2 tea spoon fromage\n');
    const el = ta(f);
    const line = new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(line);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.componentInstance.text()).toBe('2 tsp cheese\n');

    el.value = '2 big spoon fromage\n1 soup spoon fromage\n\n3 fromage';
    el.dispatchEvent(new Event('paste', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    f.detectChanges();
    expect(f.componentInstance.text()).toBe('2 tbsp cheese\n1 tbsp cheese\n\n3 cheese');
    expect(f.nativeElement.querySelectorAll('[data-qa="ingredient-preview"] > li').length).toBe(3);
  });

  it('the preview shows quantity, unit, name and aisle, and flags unknown names', async () => {
    const f = setup('2 tbsp butter\n1 zorblax');
    f.componentRef.setInput('checks', {
      butter: check('butter', { canonical: 'butter', names: { en: 'butter', fr: 'beurre', ar: 'زبدة' } }),
      zorblax: check('zorblax', { canonical: 'zorblax', known: false, exact: false, names: null, aisle: 'other' }),
    });
    f.detectChanges();
    const rows = [...f.nativeElement.querySelectorAll('[data-qa="ingredient-preview"] > li')] as HTMLElement[];
    expect(rows[0].textContent?.replace(/\s+/g, ' ')).toMatch(/2 tbsp ?\(30 ml · ≈ 28 g\) ?· ?butter ?· ?Dairy & eggs/);
    const flag = rows[1].querySelector('[data-qa="ingredient-unknown"]') as HTMLElement;
    expect(flag).toBeTruthy();
    let asked = '';
    f.componentInstance.aisleRequested.subscribe(k => (asked = k));
    flag.click();
    expect(asked).toBe('zorblax');
  });
});
