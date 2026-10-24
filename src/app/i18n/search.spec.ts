import { Recipe } from '../models';
import { matchesQuery } from '../utils/picker';
import { normalizeSearch, recipeSearchText } from './search';
import { loadAllDictionaries } from './dictionaries';

beforeAll(() => loadAllDictionaries());

function recipe(patch: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1', name: 'Gâteau au yaourt', description: '', image: '', imageCredit: null, cuisine: 'Algerian', region: null,
    mealTypes: ['dessert'], servings: 4, prepTime: 10, cookTime: 30, totalTime: 40, difficulty: 'easy', traditional: true, budget: 'low',
    diet: { vegetarian: true, vegan: false, glutenFree: false, dairyFree: false, containsPork: false, containsAlcohol: false, containsNuts: false },
    tags: ['cake'],
    ingredients: [
      { group: null, quantity: 100, unit: 'g', name: 'beurre', note: null, canonical: 'butter', known: true, names: { en: 'butter', fr: 'beurre', ar: 'زبدة' } },
      { group: null, quantity: 1, unit: null, name: 'zorblax', note: null, known: false, names: null },
    ],
    steps: [], tips: [], nutrition: null, source: null, author: null, dateAdded: '2026-10-01', ownerId: null, isPublic: true, isOfficial: false,
    parentRecipeId: null, twistCount: 0, ...patch,
  };
}

describe('multilingual recipe search', () => {
  it('finds an ingredient typed in French by its English and Arabic names', () => {
    const r = recipe();
    expect(matchesQuery(r, 'butter')).toBe(true);
    expect(matchesQuery(r, 'beurre')).toBe(true);
    expect(matchesQuery(r, 'زبدة')).toBe(true);
    expect(matchesQuery(r, 'zorblax')).toBe(true);
    expect(matchesQuery(r, 'margarine')).toBe(false);
  });

  it('is accent-insensitive and matches the cuisine in every language', () => {
    const r = recipe();
    expect(matchesQuery(r, 'gateau')).toBe(true);
    expect(matchesQuery(r, 'algérienne')).toBe(true);
    expect(matchesQuery(r, 'algerienne')).toBe(true);
    expect(matchesQuery(r, 'جزائري')).toBe(true);
  });

  it('also searches author translations', () => {
    const r = recipe({ translations: { ar: { name: 'كعكة اللبن' } } });
    expect(recipeSearchText(r)).toContain(normalizeSearch('كعكة'));
  });

  it('uses the server search blob on catalog summaries instead of ingredients', () => {
    const r = recipe({ search: 'Tarte | citron | lemon' });
    expect(matchesQuery(r, 'citron')).toBe(true);
    expect(matchesQuery(r, 'lemon')).toBe(true);
    expect(matchesQuery(r, 'beurre')).toBe(false);
  });

  it('folds Arabic letter variants', () => {
    expect(normalizeSearch('أَرُز')).toBe(normalizeSearch('ارز'));
    expect(normalizeSearch('مدرسة')).toBe(normalizeSearch('مدرسه'));
  });
});
