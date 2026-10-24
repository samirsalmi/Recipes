import { Recipe } from '../models';
import { PickerContext, fitsSlot, pickerRecipes } from './picker';

function recipe(id: string, patch: Partial<Recipe> = {}): Recipe {
  return {
    id, name: id, description: '', image: '', imageCredit: null, cuisine: 'Testish', region: null,
    mealTypes: ['dinner'], servings: 4, prepTime: 10, cookTime: 30, totalTime: 40, difficulty: 'easy',
    traditional: true, budget: 'medium',
    diet: { vegetarian: false, vegan: false, glutenFree: false, dairyFree: false, containsPork: false, containsAlcohol: false, containsNuts: false },
    tags: [], ingredients: [{ group: null, quantity: 1, unit: null, name: 'onion', note: null }], steps: [], tips: [],
    nutrition: null, source: null, author: null, dateAdded: '2026-10-01', ownerId: null, isPublic: true, isOfficial: true,
    parentRecipeId: null, twistCount: 0, ...patch,
  };
}

const recipes = [
  recipe('stew'),
  recipe('salad', { totalTime: 15, mealTypes: ['lunch'], ingredients: [{ group: null, quantity: 1, unit: null, name: 'lentils', note: null }] }),
  recipe('pancakes', { totalTime: 20, mealTypes: ['breakfast'] }),
  recipe('dal', { budget: 'low' }),
  recipe('lobster', { budget: 'high' }),
];

function ctx(patch: Partial<PickerContext> = {}): PickerContext {
  return {
    recipes, myFavorites: new Set(['stew']), householdFavorites: new Map([['dal', ['Amina']], ['stew', ['Amina']]]),
    cooked: [{ recipeId: 'salad', count: 2, lastDate: '2026-10-10' }], slot: 'dinner', plannedThisWeek: new Set(),
    preferBudget: false, ...patch,
  };
}

describe('plan picker filtering', () => {
  it('favorites tab lists yours first, then household members\' without duplicates', () => {
    expect(pickerRecipes('favorites', '', ctx()).map(r => r.id)).toEqual(['stew', 'dal']);
  });

  it('recent tab follows cooked stats', () => {
    expect(pickerRecipes('recent', '', ctx()).map(r => r.id)).toEqual(['salad']);
  });

  it('quick tab keeps <= 30 min recipes that fit the slot, fastest first', () => {
    expect(pickerRecipes('quick', '', ctx({ slot: 'lunch' })).map(r => r.id)).toEqual(['salad']);
    expect(pickerRecipes('quick', '', ctx({ slot: 'breakfast' })).map(r => r.id)).toEqual(['pancakes']);
  });

  it('suggested favours budget recipes when the household prefers them and pushes planned ones down', () => {
    const ids = pickerRecipes('suggested', '', ctx({ preferBudget: true, plannedThisWeek: new Set(['dal']) })).map(r => r.id);
    expect(ids[ids.length - 1]).toBe('dal');
    expect(ids.indexOf('lobster')).toBeGreaterThan(ids.indexOf('stew'));
    expect(ids).not.toContain('pancakes');
  });

  it('search ignores the tab and matches ingredients, slot fits first', () => {
    expect(pickerRecipes('recent', 'lentil', ctx()).map(r => r.id)).toEqual(['salad']);
    expect(pickerRecipes('favorites', 'a', ctx()).map(r => r.id)[0]).not.toBe('pancakes');
    expect(fitsSlot(recipe('x', { mealTypes: [] }), 'snack')).toBe(true);
  });
});
