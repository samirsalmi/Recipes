import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { I18nService } from '../../i18n/i18n.service';
import { Ingredient, Recipe } from '../../models';
import {
  AuthService, CollectionService, DisplayPrefsService, FavoritesService, HouseholdService, MealPlanService,
  RecipeService, StorageService, TimerService, ToastService,
} from '../../services';
import { RecipeDetailComponent } from './recipe-detail.component';

const ing = (patch: Partial<Ingredient>): Ingredient => ({ group: null, quantity: null, unit: null, name: '', note: null, ...patch });

function recipe(servings: number, ingredients: Ingredient[]): Recipe {
  return {
    id: 'r1', name: 'Test', description: '', image: '', imageCredit: null, cuisine: null, region: null, mealTypes: [], servings,
    prepTime: null, cookTime: null, totalTime: null, difficulty: null, traditional: false, budget: null,
    diet: { vegan: false, vegetarian: false, glutenFree: false, dairyFree: false, containsPork: false, containsAlcohol: false, containsNuts: false },
    tags: [], ingredients, steps: [], tips: [], nutrition: null, source: null, author: null, dateAdded: '', ownerId: null,
    isPublic: true, isOfficial: false, parentRecipeId: null, twistCount: 0,
  } as unknown as Recipe;
}

describe('RecipeDetailComponent: metric equivalents', () => {
  function setup(ingredients: Ingredient[]) {
    const base = recipe(4, ingredients);
    const recipes = {
      recipes: signal([base]), recipesLoaded: signal(true), resolveRecipe: () => of(null),
      recordView: () => undefined, recentlyViewedRecipes: signal([]),
      scaleRecipe: (r: Recipe, n: number) => ({ ...r, servings: n, ingredients: r.ingredients.map(i => ({ ...i, quantity: i.quantity === null ? null : (i.quantity * n) / r.servings })) }),
    };
    const stub = (extra: object = {}) => ({ useValue: new Proxy(extra, { get: (t, k) => (k in t ? (t as never)[k] : signal(null)) }) });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RecipeService, useValue: recipes },
        { provide: HouseholdService, useValue: { household: signal(null) } },
        { provide: AuthService, useValue: { currentUser: signal(null), isAuthenticated: signal(false) } },
        { provide: ToastService, useValue: { show: vi.fn() } },
        { provide: StorageService, ...stub({ get: () => of(null) }) },
        { provide: FavoritesService, ...stub({ myFavoriteIds: signal(new Set()), isFavorite: () => false }) },
        { provide: CollectionService, ...stub({ collections: signal([]) }) },
        { provide: MealPlanService, ...stub({ cookedCounts: signal(new Map()), timesCooked: () => 0 }) },
        { provide: TimerService, ...stub() },
      ],
    });
    const fixture = TestBed.createComponent(RecipeDetailComponent);
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    return fixture;
  }

  const rows = (fixture: ReturnType<typeof setup>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('[role=checkbox]')].map(el => el.textContent!.replace(/\s+/g, ' ').trim());

  beforeEach(() => localStorage.clear());

  it('shows "2 tbsp (30 ml)" and a flour cup as "(240 ml · ≈ 120 g)"', () => {
    const fixture = setup([
      ing({ quantity: 2, unit: 'tbsp', name: 'olive oil', canonical: 'olive oil' }),
      ing({ quantity: 1, unit: 'cup', name: 'flour', canonical: 'flour' }),
      ing({ quantity: 200, unit: 'g', name: 'sugar', canonical: 'sugar' }),
    ]);
    fixture.componentInstance.units.set('us');
    fixture.detectChanges();
    const text = rows(fixture);
    expect(text[0]).toContain('2 tbsp (30 ml)');
    expect(text[1]).toContain('(240 ml · ≈ 120 g)');
    expect(text[2]).toContain('7 oz (200 g)'); // US view of 200 g
    fixture.componentInstance.units.set('metric');
    fixture.detectChanges();
    expect(rows(fixture)[2]).not.toContain('(');
    expect(rows(fixture)[1]).toContain('240 ml (≈ 120 g)');
  });

  it('computes from the scaled quantity', () => {
    const fixture = setup([ing({ quantity: 1, unit: 'cup', name: 'flour', canonical: 'flour' })]);
    fixture.componentInstance.servings.set(8);
    fixture.detectChanges();
    expect(rows(fixture)[0]).toContain('(≈ 240 g)');
  });

  it('hides equivalents when the device toggle is off', () => {
    const fixture = setup([ing({ quantity: 2, unit: 'tbsp', name: 'oil' })]);
    TestBed.inject(DisplayPrefsService).setShowEquivalents(false);
    fixture.detectChanges();
    expect(rows(fixture)[0]).not.toContain('(30 ml)');
    expect(TestBed.inject(I18nService).equivalent(2, 'tbsp')).toBe('');
  });
});
