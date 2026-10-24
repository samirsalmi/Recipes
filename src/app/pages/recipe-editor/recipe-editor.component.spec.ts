import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Aisle, IngredientCheck } from '../../models';
import { AuthService, RecipeService, StorageService, ToastService } from '../../services';
import { RecipeEditorComponent } from './recipe-editor.component';

function check(name: string, canonical: string, known: boolean, aisle: Aisle = 'other', remembered = false): IngredientCheck {
  return { name, canonical, known, aisle, remembered };
}

describe('RecipeEditorComponent: unknown ingredients ask "Which aisle?"', () => {
  let storage: { checkIngredients: ReturnType<typeof vi.fn>; rememberIngredientAisle: ReturnType<typeof vi.fn> };
  let recipes: { createRecipe: ReturnType<typeof vi.fn> };

  function setup() {
    storage = {
      checkIngredients: vi.fn((names: string[]) =>
        of(names.map(n => (n === 'ماء الزهر الخاص' ? check(n, 'ماء زهر خاص', false, 'pantry') : check(n, n, true, 'dairy-eggs'))))),
      rememberIngredientAisle: vi.fn((name: string, aisle: Aisle) => of({ id: 1, name, aisle, known: false, stored: true })),
    };
    recipes = { createRecipe: vi.fn(() => of({ id: 'r1' })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StorageService, useValue: storage },
        { provide: RecipeService, useValue: recipes },
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        { provide: ToastService, useValue: { show: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(RecipeEditorComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function typeIngredients(fixture: ReturnType<typeof setup>, text: string) {
    fixture.componentInstance.ingredientsText.set(text);
    fixture.detectChanges(); // runs the effect that queues the check
    await vi.advanceTimersByTimeAsync(450); // debounce
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('asks the server only after typing pauses, once per distinct set of names', async () => {
    const fixture = setup();
    fixture.componentInstance.ingredientsText.set('2 beurre');
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(100);
    fixture.componentInstance.ingredientsText.set('2 beurre\n3 farine');
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(450);
    expect(storage.checkIngredients).toHaveBeenCalledTimes(1);
    expect(storage.checkIngredients).toHaveBeenCalledWith(['beurre', 'farine']);
    fixture.componentInstance.ingredientsText.set('2 beurre\n3 farine\n'); // same names
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(450);
    expect(storage.checkIngredients).toHaveBeenCalledTimes(1);
  });

  it('shows no picker when every name is recognized', async () => {
    const fixture = setup();
    await typeIngredients(fixture, '٢٥٠ غرام من الدقيق\n2 c. à s. de beurre');
    expect(storage.checkIngredients).toHaveBeenCalledWith(['الدقيق', 'beurre']);
    expect(fixture.nativeElement.querySelector('[data-qa="aisle-picker"]')).toBeNull();
  });

  it('shows one row per unknown name with the 10 aisles as radio chips (44px targets)', async () => {
    const fixture = setup();
    await typeIngredients(fixture, '2 beurre\n1 ماء الزهر الخاص\n2 ماء الزهر الخاص');
    const rows = fixture.nativeElement.querySelectorAll('[data-qa="aisle-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('ماء الزهر الخاص');
    expect(rows[0].textContent).toContain('Which aisle?');
    const chips = rows[0].querySelectorAll('button[role="radio"]');
    expect(chips.length).toBe(10);
    expect(chips[0].className).toContain('min-h-[44px]');
    // The keyword/remembered guess is pre-selected but not yet "chosen".
    expect(rows[0].querySelector('[data-qa="aisle-pantry"]').getAttribute('aria-checked')).toBe('true');
  });

  it('one tap selects the aisle, remembers it, and sends it with the recipe for that ingredient only', async () => {
    const fixture = setup();
    await typeIngredients(fixture, '2 beurre\n1 ماء الزهر الخاص');
    fixture.nativeElement.querySelector('[data-qa="aisle-drinks"]').click();
    fixture.detectChanges();
    expect(storage.rememberIngredientAisle).toHaveBeenCalledWith('ماء الزهر الخاص', 'drinks');
    const row = fixture.nativeElement.querySelector('[data-qa="aisle-row"]');
    expect(row.querySelector('[data-qa="aisle-drinks"]').getAttribute('aria-checked')).toBe('true');
    expect(row.textContent).not.toContain('Which aisle?');

    fixture.componentInstance.name = 'Eau de fleurs';
    fixture.componentInstance.save();
    expect(recipes.createRecipe).toHaveBeenCalledTimes(1);
    const sent = recipes.createRecipe.mock.calls[0][0];
    expect(sent.ingredients.map((i: { name: string; aisle?: string }) => [i.name, i.aisle])).toEqual([
      ['beurre', undefined],
      ['ماء الزهر الخاص', 'drinks'],
    ]);
  });

  it('a remembered household choice is shown as already chosen', async () => {
    const fixture = setup();
    storage.checkIngredients.mockReturnValue(of([check('ماء الزهر الخاص', 'ماء زهر خاص', false, 'bakery', true)]));
    await typeIngredients(fixture, '1 ماء الزهر الخاص');
    const row = fixture.nativeElement.querySelector('[data-qa="aisle-row"]');
    expect(row.textContent).not.toContain('Which aisle?');
    expect(row.querySelector('[data-qa="aisle-bakery"]').getAttribute('aria-checked')).toBe('true');
  });
});
