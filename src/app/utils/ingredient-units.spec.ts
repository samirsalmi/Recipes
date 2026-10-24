import { unitCode } from '../i18n/units';
import { ParsedIngredient, parseIngredientLine } from './ingredient-parser';

function ing(line: string): ParsedIngredient {
  const parsed = parseIngredientLine(line);
  if (!parsed || parsed.kind !== 'ingredient') throw new Error(`not an ingredient: ${line}`);
  return parsed.ingredient;
}

describe('unit spellings (every language and spelling)', () => {
  const tbsp = ['2 table spoons butter', '2 tablespoon butter', '2 tbsp butter', '2 tbs butter', '2 T butter', '2 soup spoons butter',
    '2 big spoons butter', '2 large spoon butter', '2 Table Spoon butter', '2 cuillères à soupe de beurre', '2 c. à s. de beurre',
    '2 grandes cuillères de beurre', '2 ملعقة كبيرة زبدة', '2 ملاعق طعام زبدة', '٢ ملعقة طعام زبدة'];
  it.each(tbsp)('reads "%s" as 2 tbsp of butter, not a name', line => {
    const r = ing(line);
    expect([r.quantity, r.unit]).toEqual([2, 'tbsp']);
    expect(r.name).toMatch(/^(butter|beurre|زبدة)$/);
  });

  const tsp = ['1 tea spoon salt', '1 teaspoon salt', '1 tsp salt', '1 small spoon salt', '1 little spoon salt', '1 coffee spoon salt',
    '1 cuillère à café de sel', '1 c. à c. de sel', '1 cac de sel', '1 petite cuillère de sel', '1 ملعقة صغيرة ملح', '1 ملعقة شاي ملح'];
  it.each(tsp)('reads "%s" as 1 tsp of salt', line => {
    const r = ing(line);
    expect([r.quantity, r.unit]).toEqual([1, 'tsp']);
    expect(r.name).toMatch(/^(salt|sel|ملح)$/);
  });

  it('keeps the typed spelling for the form to rewrite', () => {
    expect(ing('2 table spoon butter').unitTyped).toBe('table spoon');
    expect(ing('2 T butter').unitTyped).toBe('T');
    expect(ing('2 butter').unitTyped).toBeUndefined();
  });

  it('a capital T is a tablespoon but a plain word starting with t is not', () => {
    expect(ing('1 T oil').unit).toBe('tbsp');
    expect(ing('2 tomatoes')).toMatchObject({ unit: null, name: 'tomatoes' });
    expect(ing('2 Tomatoes').unit).toBeNull();
  });

  it('a dessert spoon is two teaspoons', () => {
    expect(ing('2 dessert spoons sugar')).toMatchObject({ quantity: 4, unit: 'tsp', name: 'sugar', unitFactor: 2 });
    expect(ing('1 cuillère à dessert de sucre')).toMatchObject({ quantity: 2, unit: 'tsp' });
  });

  it('cup / glass / pinch / clove / bunch / can / handful in three languages', () => {
    expect(ing('1 glass milk').unit).toBe('cup');
    expect(ing('1 verre de lait').unit).toBe('cup');
    expect(ing('1 كوب حليب').unit).toBe('cup');
    expect(ing('1 tasse de lait').unit).toBe('cup');
    expect(ing('1 cup milk').unit).toBe('cup');
  });

  it('small cup: coffee / tea cups in three languages, distinct from the 240 ml cup', () => {
    expect(ing('1 فنجان قهوة').unit).toBe('small cup');
    expect(ing('2 فناجين سكر')).toMatchObject({ quantity: 2, unit: 'small cup', name: 'سكر' });
    expect(ing('1 coffee cup sugar').unit).toBe('small cup');
    expect(ing('1 tea cup milk').unit).toBe('small cup');
    expect(ing('1 teacup milk').unit).toBe('small cup');
    expect(ing('2 small cups flour')).toMatchObject({ quantity: 2, unit: 'small cup', name: 'flour' });
    expect(ing('1 demi-tasse de lait').unit).toBe('small cup');
    expect(ing('1 tasse à café de sucre').unit).toBe('small cup');
    expect(ing('1 tasse à thé de lait').unit).toBe('small cup');
    expect(ing('1 petite tasse de sucre')).toMatchObject({ unit: 'small cup', name: 'sucre' });
    expect(unitCode('فنجان')).toBe('small cup');
    expect(ing('1 pincée de sel').unit).toBe('pinch');
    expect(ing('1 رشة ملح').unit).toBe('pinch');
    expect(ing("2 gousses d'ail").unit).toBe('clove');
    expect(ing('2 فص ثوم').unit).toBe('clove');
    expect(ing('1 botte de persil').unit).toBe('bunch');
    expect(ing('1 حزمة بقدونس').unit).toBe('bunch');
    expect(ing('1 boîte de tomates').unit).toBe('can');
    expect(ing('1 tin tomatoes').unit).toBe('can');
    expect(ing('1 قبضة لوز').unit).toBe('handful');
    expect(ing('1 handful almonds').unit).toBe('handful');
  });

  it('still turns serving words into a note with a plain count', () => {
    expect(ing('4 portions de fromage')).toMatchObject({ quantity: 4, unit: null, name: 'fromage', note: 'portions' });
    expect(ing('3 slices bread')).toMatchObject({ unit: null, note: 'slices' });
  });

  it('copes with pasted non-breaking spaces and bullets', () => {
    expect(ing('• 2 table spoon butter')).toMatchObject({ quantity: 2, unit: 'tbsp', name: 'butter' });
  });
});
