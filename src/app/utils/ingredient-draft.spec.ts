import { suggestUnits, unitCode } from '../i18n/units';
import { IngredientCheck } from '../models';
import { applyEdits, autoTranslation, draftContext, lineAt, nameReplacement, splitLines, unitReplacement } from './ingredient-draft';
import { parseIngredientLine } from './ingredient-parser';

function check(name: string, over: Partial<IngredientCheck> = {}): IngredientCheck {
  return {
    name, canonical: 'cheese', known: true, aisle: 'dairy-eggs', remembered: false,
    names: { en: 'cheese', fr: 'fromage', ar: 'جبن' }, exact: true, languages: ['fr', 'en'], ...over,
  };
}

describe('lines', () => {
  it('finds the caret line, including a caret at a line end', () => {
    const text = '2 cups flour\n\n1 tsp salt';
    expect(splitLines(text).map(l => l.text)).toEqual(['2 cups flour', '', '1 tsp salt']);
    expect(lineAt(text, 12).index).toBe(0);
    expect(lineAt(text, 13).index).toBe(1);
    expect(lineAt(text, 20).text).toBe('1 tsp salt');
  });
});

describe('draftContext', () => {
  it('suggests names for the word being typed', () => {
    expect(draftContext('fromage').name).toMatchObject({ query: 'fromage', start: 0, hasUnit: false });
    expect(draftContext('2 cups flo').name).toMatchObject({ query: 'flo', start: 7, hasUnit: true });
    expect(draftContext('250 g de farine').name).toMatchObject({ query: 'farine', hasUnit: true });
  });
  it('suggests units right after the quantity', () => {
    expect(draftContext('2 tab').unit).toMatchObject({ partial: 'tab', start: 2, quantity: 2 });
    expect(draftContext('2 table sp').unit?.partial).toBe('table sp');
    expect(draftContext('2 cups flour').unit).toBeUndefined();
  });
  it('stays quiet in notes, groups and short or empty names', () => {
    expect(draftContext('2 cups flour, sif')).toEqual({});
    expect(draftContext('1 cup (about 200')).toEqual({});
    expect(draftContext('Sauce:')).toEqual({});
    expect(draftContext('f').name).toBeUndefined();
    expect(draftContext('2 cups').name).toBeUndefined();
    expect(draftContext('')).toEqual({});
  });
});

describe('suggestUnits', () => {
  it('completes partial spellings in any language', () => {
    expect(suggestUnits('tab')[0].code).toBe('tbsp');
    expect(suggestUnits('table sp')[0]).toMatchObject({ code: 'tbsp', matched: 'table spoon' });
    expect(suggestUnits('teas')[0].code).toBe('tsp');
    expect(suggestUnits('tea').map(u => u.code)).toEqual(expect.arrayContaining(['tsp', 'small cup']));
    expect(suggestUnits('cuill').map(u => u.code)).toEqual(expect.arrayContaining(['tbsp', 'tsp']));
    expect(suggestUnits('ملعقة ك')[0].code).toBe('tbsp');
    expect(suggestUnits('t')).toEqual([]);
    expect(suggestUnits('zzzz')).toEqual([]);
  });
  it('knows the loose spellings', () => {
    for (const s of ['table spoon', 'soup spoon', 'big spoon', 'large spoon']) expect(unitCode(s)).toBe('tbsp');
    for (const s of ['tea spoon', 'small spoon', 'little spoon', 'coffee spoon', 'petite cuillère']) expect(unitCode(s)).toBe('tsp');
  });
});

describe('nameReplacement', () => {
  const run = (text: string, name: string, label: string, lang: 'en' | 'fr' | 'ar', hasUnit: boolean) => {
    const at = text.lastIndexOf(name);
    return applyEdits(text, [nameReplacement(text, at, at + name.length, label, lang, hasUnit)]);
  };
  it('swaps the name and keeps quantity and unit', () => {
    expect(run('2 fromage', 'fromage', 'cheese', 'en', false)).toBe('2 cheese');
    expect(run('2 cups fromage', 'fromage', 'cheese', 'en', true)).toBe('2 cups cheese');
  });
  it('drops the French particle for English and Arabic, adds it for French', () => {
    expect(run('250 g de farine', 'farine', 'flour', 'en', true)).toBe('250 g flour');
    expect(run("3 gousses d'ail", 'ail', 'garlic', 'en', true)).toBe('3 gousses garlic');
    expect(run('250 g flour', 'flour', 'farine', 'fr', true)).toBe('250 g de farine');
    expect(run('1 tbsp oil', 'oil', 'huile', 'fr', true)).toBe("1 tbsp d'huile");
    expect(run('2 onions', 'onions', 'oignons', 'fr', false)).toBe('2 oignons');
    expect(run('250 g de farine', 'farine', 'دقيق', 'ar', true)).toBe('250 g دقيق');
  });
});

describe('unitReplacement', () => {
  const edit = (line: string, label: string) => {
    const parsed = parseIngredientLine(line);
    if (parsed?.kind !== 'ingredient') throw new Error('x');
    const e = unitReplacement(line, parsed.ingredient, label);
    return e ? applyEdits(line, [e]) : null;
  };
  it('rewrites to the reader-language display form', () => {
    expect(edit('2 table spoon butter', 'tbsp')).toBe('2 tbsp butter');
    expect(edit('2 table spoons butter', 'c. à s.')).toBe('2 c. à s. butter');
    expect(edit('2 cuillères à soupe de beurre', 'tbsp')).toBe('2 tbsp de beurre');
    expect(edit('2 T butter', 'tbsp')).toBe('2 tbsp butter');
    expect(edit('1 glass milk', 'cup')).toBe('1 cup milk');
  });
  it('leaves already-correct, converted and unknown units alone', () => {
    expect(edit('2 tbsp butter', 'tbsp')).toBeNull();
    expect(edit('2 dessert spoons sugar', 'tsp')).toBeNull();
    expect(edit('2 cl rum', 'ml')).toBeNull();
    expect(edit('2 onions', 'tbsp')).toBeNull();
  });
});

describe('autoTranslation: only confident exact matches, per reader language', () => {
  it('translates an exact foreign spelling to the reader language', () => {
    expect(autoTranslation(check('fromage'), 'fromage', 'en')).toBe('cheese');
    expect(autoTranslation(check('cheese', { languages: ['en'] }), 'cheese', 'fr')).toBe('fromage');
    expect(autoTranslation(check('cheese', { languages: ['en'] }), 'cheese', 'ar')).toBe('جبن');
  });
  it('leaves text that is already in the reader language, or that is not an exact match', () => {
    expect(autoTranslation(check('fromage'), 'fromage', 'fr')).toBeNull();
    expect(autoTranslation(check('cheese', { languages: ['en'] }), 'cheese', 'en')).toBeNull();
    expect(autoTranslation(check('fromagge', { exact: false }), 'fromagge', 'en')).toBeNull(); // typo: suggest only
    expect(autoTranslation(check('x', { known: false, names: null }), 'x', 'en')).toBeNull();
    expect(autoTranslation(undefined, 'fromage', 'en')).toBeNull();
    expect(autoTranslation(check('mozzarella', { names: { en: 'mozzarella', fr: 'mozzarella', ar: 'موزاريلا' } }), 'mozzarella', 'fr')).toBeNull();
  });
});
