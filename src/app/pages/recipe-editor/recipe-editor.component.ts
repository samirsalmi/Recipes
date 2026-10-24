import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { IconComponent } from '../../components';
import { IngredientFieldComponent } from '../../components/ingredient-field/ingredient-field.component';
import { I18nService } from '../../i18n/i18n.service';
import {
  AISLES, Aisle, Budget, DietFlags, IngredientCheck, MEAL_TYPES, MealType, Recipe, RecipeCreateInput, RecipeDraft,
} from '../../models';
import { AuthService, RecipeService, StorageService, ToastService } from '../../services';
import { parseIngredientText } from '../../utils/ingredient-parser';
import { ingredientsToText, stepsToText, textToSteps } from '../../utils/recipe-text';

const DIET_FIELDS: { key: keyof DietFlags }[] = [
  { key: 'vegetarian' }, { key: 'vegan' }, { key: 'glutenFree' }, { key: 'dairyFree' },
  { key: 'containsPork' }, { key: 'containsAlcohol' }, { key: 'containsNuts' },
];

const EMPTY_DIET: DietFlags = {
  vegetarian: false, vegan: false, glutenFree: false, dairyFree: false,
  containsPork: false, containsAlcohol: false, containsNuts: false,
};

/** One "Which aisle?" row of the recipe form (an ingredient the dictionary does not know). */
export interface AisleRow {
  /** Canonical (normalized) name; what picks are keyed by. */
  key: string;
  /** The name as typed, shown to the user. */
  label: string;
  /** The selected aisle: their pick, the household's remembered one, or a keyword guess. */
  aisle: Aisle;
  /** True once the user (or an earlier pick of the household) decided, false while it is a guess. */
  chosen: boolean;
}

/** /recipes/new and /recipes/:id/edit (authGuard). Only name + ingredients are required:
 *  ingredients are one textarea parsed live (chips show how each line was read; English, French
 *  and Arabic lines work, and names the server dictionary does not know get a one-tap "Which
 *  aisle?" picker, remembered per household), steps are a
 *  textarea, everything else sits under "More details" (incl. traditional + budget). Import
 *  from a link prefills it (POST /api/recipes/import-url). New recipes autosave a draft to
 *  localStorage (restore banner on return). */
@Component({
  selector: 'app-recipe-editor',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, IngredientFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page max-w-2xl">
      <a [routerLink]="id() ? ['/recipes', id()] : ['/cookbook']" class="btn-ghost -ms-3"><app-icon name="arrow-left" [size]="18" /> {{ t('edit.back') }}</a>
      <h1 class="page-title mt-2">{{ id() ? t('edit.editTitle') : t('edit.addTitle') }}</h1>

      @if (!id()) {
        <form class="mt-5 flex gap-2" (ngSubmit)="importUrl()">
          <label class="sr-only" for="import-url">{{ t('edit.importLabel') }}</label>
          <input id="import-url" name="importUrl" class="input" type="url" dir="ltr" [placeholder]="t('edit.importPlaceholder')" [(ngModel)]="importLink" />
          <button type="submit" class="btn-secondary" [disabled]="importing() || !importLink.trim()">
            <app-icon name="link" [size]="18" /> {{ importing() ? t('edit.importing') : t('edit.import') }}
          </button>
        </form>
      }

      @if (draftAvailable()) {
        <div class="mt-5 flex flex-wrap items-center gap-3 rounded-card bg-saffron/20 p-4" role="status">
          <p class="flex-1 text-sm"><span class="font-semibold">{{ t('edit.draftTitle') }}</span>{{ draftName() ? ': ' + draftName() : '' }}</p>
          <button type="button" class="btn-primary min-h-[40px]" (click)="restoreDraft()">{{ t('common.restore') }}</button>
          <button type="button" class="btn-ghost min-h-[40px]" (click)="discardDraft()">{{ t('common.discard') }}</button>
        </div>
      }

      <form class="mt-6 space-y-6" (ngSubmit)="save()" (input)="queueDraft()" (click)="queueDraft()">
        <div>
          <label class="label" for="r-name">{{ t('edit.name') }}</label>
          <input id="r-name" name="name" class="input" required [(ngModel)]="name" dir="auto" />
        </div>

        <div>
          <div class="flex items-baseline justify-between">
            <label class="label" for="r-ingredients">{{ t('edit.ingredients') }}</label>
            <span class="text-xs text-muted">{{ t('edit.ingHint') }}</span>
          </div>
          <app-ingredient-field [(text)]="ingredientsText" [checks]="checks()" [picks]="picks()" (aisleRequested)="focusAisle($event)" />
          <p class="mt-1 text-xs text-muted">{{ t('edit.ingMixedHint') }}</p>
          @if (unknownRows().length) {
            <div class="mt-3 space-y-2" data-qa="aisle-picker" role="group" [attr.aria-label]="t('edit.aisleGroup')">
              @for (row of unknownRows(); track row.key) {
                <div class="rounded-card bg-sunken px-3 py-2" data-qa="aisle-row" [attr.data-key]="row.key">
                  <p class="text-sm">
                    <span class="font-semibold text-ink" dir="auto">{{ row.label }}</span>
                    <span class="text-muted"> - {{ row.chosen ? t('edit.aisle') : t('edit.whichAisle') }}</span>
                  </p>
                  <div class="-mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" [attr.aria-label]="t('edit.aisleFor', { name: row.label })">
                    @for (a of aisles; track a.id) {
                      <button type="button" role="radio" class="chip min-h-[44px] shrink-0" [class.chip-active]="row.aisle === a.id"
                              [attr.aria-checked]="row.aisle === a.id" [attr.data-qa]="'aisle-' + a.id" (click)="chooseAisle(row, a.id)">{{ i18n.aisle(a.id) }}</button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div>
          <label class="label" for="r-steps">{{ t('edit.steps') }} <span class="font-normal text-muted">({{ t('common.optional') }})</span></label>
          <textarea id="r-steps" name="steps" dir="auto" class="textarea min-h-[160px]" [placeholder]="t('edit.stepsPlaceholder')" [(ngModel)]="stepsText"></textarea>
        </div>

        <div>
          <span class="label">{{ t('edit.photo') }} <span class="font-normal text-muted">({{ t('common.optional') }})</span></span>
          <div class="flex items-center gap-3">
            @if (image()) { <img [src]="image()" alt="" class="h-20 w-28 rounded-2xl object-cover" /> }
            <label class="btn-secondary cursor-pointer">
              <app-icon name="camera" [size]="18" /> {{ uploading() ? t('edit.uploading') : image() ? t('edit.changePhoto') : t('edit.addPhoto') }}
              <input type="file" accept="image/*" capture="environment" class="sr-only" (change)="upload($event)" [disabled]="uploading()" />
            </label>
            @if (image()) { <button type="button" class="btn-ghost" (click)="image.set('')">{{ t('common.remove') }}</button> }
          </div>
        </div>

        <details class="rounded-card border border-hairline bg-surface px-4 py-3" [open]="!!id()">
          <summary class="cursor-pointer font-semibold">{{ t('edit.moreDetails') }}</summary>
          <div class="mt-4 space-y-5">
            <div>
              <label class="label" for="r-desc">{{ t('edit.description') }}</label>
              <textarea id="r-desc" name="description" dir="auto" class="textarea" rows="2" [(ngModel)]="description"></textarea>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="label" for="r-serv">{{ t('edit.servings') }}</label><input id="r-serv" name="servings" type="number" min="1" class="input" [(ngModel)]="servings" /></div>
              <div><label class="label" for="r-prep">{{ t('edit.prep') }}</label><input id="r-prep" name="prep" type="number" min="0" class="input" [(ngModel)]="prepTime" /></div>
              <div><label class="label" for="r-cook">{{ t('edit.cook') }}</label><input id="r-cook" name="cook" type="number" min="0" class="input" [(ngModel)]="cookTime" /></div>
            </div>
            <div><label class="label" for="r-cuisine">{{ t('edit.cuisine') }}</label><input id="r-cuisine" name="cuisine" class="input" dir="auto" [(ngModel)]="cuisine" /></div>
            <div>
              <span class="label">{{ t('edit.mealTypes') }}</span>
              <div class="flex flex-wrap gap-2">
                @for (m of mealTypes; track m) {
                  <button type="button" class="chip" [class.chip-active]="selectedMeals().includes(m)" (click)="toggleMeal(m)">{{ i18n.meal(m) }}</button>
                }
              </div>
            </div>
            <div>
              <span class="label">{{ t('edit.diet') }}</span>
              <div class="flex flex-wrap gap-2">
                @for (d of dietFields; track d.key) {
                  <button type="button" class="chip" [class.chip-active]="diet()[d.key]" (click)="toggleDiet(d.key)">{{ i18n.diet(d.key) }}</button>
                }
              </div>
            </div>
            <label class="flex items-center justify-between gap-4">
              <span><span class="font-medium">{{ t('edit.traditional') }}</span><br /><span class="text-sm text-muted">{{ t('edit.traditionalHint') }}</span></span>
              <input type="checkbox" name="traditional" class="switch" [(ngModel)]="traditional" />
            </label>
            <div>
              <span class="label">{{ t('edit.budget') }}</span>
              <div class="flex flex-wrap gap-2" role="radiogroup" [attr.aria-label]="t('edit.budget')">
                @for (b of budgets; track b.id) {
                  <button type="button" role="radio" class="chip" [class.chip-active]="budget() === b.id" [attr.aria-checked]="budget() === b.id"
                          (click)="budget.set(budget() === b.id ? null : b.id)">{{ i18n.tx('edit.budget.' + b.id) }}</button>
                }
              </div>
            </div>
            <div><label class="label" for="r-tags">{{ t('edit.tags') }}</label><input id="r-tags" name="tags" class="input" dir="auto" [placeholder]="t('edit.tagsPlaceholder')" [(ngModel)]="tags" /></div>
            <div><label class="label" for="r-tips">{{ t('edit.tips') }}</label><textarea id="r-tips" name="tips" dir="auto" class="textarea" rows="2" [placeholder]="t('edit.tipsPlaceholder')" [(ngModel)]="tips"></textarea></div>
            <div><label class="label" for="r-cal">{{ t('edit.calories') }}</label><input id="r-cal" name="calories" type="number" min="0" class="input" [(ngModel)]="calories" /></div>
            <div><label class="label" for="r-src">{{ t('edit.sourceLink') }}</label><input id="r-src" name="sourceUrl" type="url" dir="ltr" class="input" [(ngModel)]="sourceUrl" /></div>
            <label class="flex items-center justify-between gap-4">
              <span class="font-medium">{{ t('edit.visible') }}</span>
              <input type="checkbox" name="isPublic" class="switch" [(ngModel)]="isPublic" />
            </label>
          </div>
        </details>

        @if (error()) { <p class="text-sm text-accent" role="alert">{{ error() }}</p> }
        <button type="submit" class="btn-primary w-full" [disabled]="!canSave() || saving()">
          {{ saving() ? t('edit.saving') : id() ? t('edit.saveChanges') : t('edit.saveRecipe') }}
        </button>
      </form>
    </div>
  `,
})
export class RecipeEditorComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  private recipes = inject(RecipeService);
  private storage = inject(StorageService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  /** Present on /recipes/:id/edit. */
  readonly id = input<string>();

  readonly mealTypes = MEAL_TYPES;
  readonly dietFields = DIET_FIELDS;
  readonly budgets: { id: Budget }[] = [{ id: 'low' }, { id: 'medium' }, { id: 'high' }];

  name = '';
  stepsText = '';
  description = '';
  servings = 4;
  prepTime: number | null = null;
  cookTime: number | null = null;
  cuisine = '';
  tags = '';
  tips = '';
  calories: number | null = null;
  sourceUrl = '';
  sourceTitle: string | null = null;
  isPublic = true;
  traditional = false;
  importLink = '';

  readonly ingredientsText = signal('');
  readonly parsed = computed(() => parseIngredientText(this.ingredientsText()));

  readonly aisles = AISLES;
  /** Server answers per typed ingredient name (does the dictionary know it?). */
  readonly checks = signal<Record<string, IngredientCheck>>({});
  /** The user's aisle picks, by canonical name; sent with the recipe for unknown names. */
  readonly picks = signal<Record<string, Aisle>>({});
  /** Aisles already stored on the recipe being edited, by typed name (re-offered, not re-asked). */
  private storedAisles: Record<string, Aisle> = {};
  private readonly nameQueries = new Subject<string[]>();
  private readonly checkNames = computed(() => [...new Set(this.parsed().map(p => p.name.trim()).filter(Boolean))].slice(0, 100));

  /** One "Which aisle?" row per unknown ingredient (typed spellings sharing a name are one row). */
  readonly unknownRows = computed<AisleRow[]>(() => {
    const checks = this.checks();
    const picks = this.picks();
    const rows = new Map<string, AisleRow>();
    for (const name of this.checkNames()) {
      const c = checks[name];
      if (!c || c.known || rows.has(c.canonical)) continue;
      const pick = picks[c.canonical];
      rows.set(c.canonical, { key: c.canonical, label: name, aisle: pick ?? c.aisle, chosen: !!pick || c.remembered });
    }
    return [...rows.values()];
  });
  readonly selectedMeals = signal<MealType[]>([]);
  readonly diet = signal<DietFlags>({ ...EMPTY_DIET });
  readonly budget = signal<Budget | null>(null);
  readonly image = signal('');
  readonly uploading = signal(false);
  readonly importing = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly draftAvailable = signal(false);
  readonly draftName = signal('');
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Ask the server which typed names it does not know, a moment after typing stops.
    this.nameQueries.pipe(
      debounceTime(400),
      distinctUntilChanged((a, b) => a.join('\n') === b.join('\n')),
      switchMap(names => (names.length ? this.storage.checkIngredients(names) : of([] as IngredientCheck[]))),
      takeUntilDestroyed(),
    ).subscribe(items => this.applyChecks(items));
    effect(() => this.nameQueries.next(this.checkNames()));
  }

  private applyChecks(items: IngredientCheck[]): void {
    this.checks.set(Object.fromEntries(items.map(c => [c.name, c])));
    // A recipe being edited: its stored aisle for a still-unknown name counts as a pick.
    const adopt: Record<string, Aisle> = {};
    for (const c of items) {
      const stored = this.storedAisles[c.name];
      if (!c.known && !c.remembered && stored && stored !== 'other' && !this.picks()[c.canonical]) adopt[c.canonical] = stored;
    }
    if (Object.keys(adopt).length) this.picks.update(p => ({ ...adopt, ...p }));
  }

  chooseAisle(row: AisleRow, aisle: Aisle): void {
    this.picks.update(p => ({ ...p, [row.key]: aisle }));
    // Remember it for this household (later recipes and the grocery list); a failure only means "ask again next time".
    this.storage.rememberIngredientAisle(row.label, aisle).subscribe({ error: () => undefined });
  }

  ngOnInit(): void {
    const id = this.id();
    if (!id) {
      const draft = readDraft();
      if (draft?.name || draft?.ingredientsText) {
        this.draftAvailable.set(true);
        this.draftName.set(draft.name ?? '');
      }
      return;
    }
    this.recipes.resolveRecipe(id).subscribe(r => {
      if (!r || r.ownerId !== this.auth.currentUser()?.id) {
        this.toast.show(this.t('edit.notOwner'), 'error');
        this.router.navigate(id && r ? ['/recipes', id] : ['/']);
        return;
      }
      this.fill(r);
    });
  }

  /** "Not in our list" on a preview line: bring that name's aisle row into view. */
  focusAisle(key: string): void {
    const row = [...document.querySelectorAll<HTMLElement>('[data-qa="aisle-row"]')].find(r => r.dataset['key'] === key);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  canSave(): boolean {
    return !!this.name.trim() && this.parsed().length > 0 && !this.uploading();
  }

  toggleMeal(m: MealType): void {
    this.selectedMeals.update(list => (list.includes(m) ? list.filter(x => x !== m) : [...list, m]));
  }

  toggleDiet(key: keyof DietFlags): void {
    this.diet.update(d => ({ ...d, [key]: !d[key] }));
  }

  upload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploading.set(true);
    this.storage.uploadImage(file).subscribe({
      next: res => {
        this.image.set(res.url);
        this.uploading.set(false);
      },
      error: () => {
        this.uploading.set(false);
        this.toast.show(this.i18n.apiError(null, 'edit.photoFail'), 'error');
      },
    });
  }

  importUrl(): void {
    const url = this.importLink.trim();
    if (!url) return;
    this.importing.set(true);
    this.recipes.importFromUrl(url).subscribe({
      next: draft => {
        this.importing.set(false);
        this.applyDraft(draft);
        this.toast.show(this.t('edit.imported'));
      },
      error: err => {
        this.importing.set(false);
        this.toast.show(this.i18n.apiError(err, 'err.importFailed'), 'error');
      },
    });
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set('');
    const input = this.buildInput();
    const id = this.id();
    const request = id ? this.recipes.updateRecipe(id, input) : this.recipes.createRecipe(input);
    request.subscribe({
      next: r => {
        if (!id) clearDraft();
        this.router.navigate(['/recipes', r.id]);
      },
      error: () => {
        this.saving.set(false);
        this.error.set(this.t('edit.saveFail'));
      },
    });
  }

  /** New recipes autosave to this device (localStorage) so a closed tab loses nothing. */
  queueDraft(): void {
    if (this.id()) return;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      if (!this.name.trim() && !this.ingredientsText().trim()) return;
      writeDraft({
        name: this.name, ingredientsText: this.ingredientsText(), stepsText: this.stepsText, description: this.description,
        servings: this.servings, prepTime: this.prepTime, cookTime: this.cookTime, cuisine: this.cuisine, tags: this.tags,
        tips: this.tips, sourceUrl: this.sourceUrl, image: this.image(), mealTypes: this.selectedMeals(), traditional: this.traditional,
        budget: this.budget(), diet: this.diet(), isPublic: this.isPublic,
      });
      this.draftAvailable.set(false);
    }, 500);
  }

  restoreDraft(): void {
    const d = readDraft();
    this.draftAvailable.set(false);
    if (!d) return;
    this.name = d.name ?? '';
    this.ingredientsText.set(d.ingredientsText ?? '');
    this.stepsText = d.stepsText ?? '';
    this.description = d.description ?? '';
    this.servings = d.servings ?? 4;
    this.prepTime = d.prepTime ?? null;
    this.cookTime = d.cookTime ?? null;
    this.cuisine = d.cuisine ?? '';
    this.tags = d.tags ?? '';
    this.tips = d.tips ?? '';
    this.sourceUrl = d.sourceUrl ?? '';
    this.image.set(d.image ?? '');
    this.selectedMeals.set(d.mealTypes ?? []);
    this.traditional = !!d.traditional;
    this.budget.set(d.budget ?? null);
    this.diet.set({ ...EMPTY_DIET, ...(d.diet ?? {}) });
    this.isPublic = d.isPublic ?? true;
  }

  discardDraft(): void {
    clearDraft();
    this.draftAvailable.set(false);
  }

  private buildInput(): RecipeCreateInput {
    const num = (v: number | null) => (v === null || (v as unknown) === '' ? null : Number(v));
    return {
      name: this.name.trim(),
      ingredients: this.parsed().map(({ group, quantity, unit, name, note, optional }) => {
        const aisle = this.pickFor(name);
        return { group, quantity, unit, name, note, optional: !!optional, ...(aisle ? { aisle } : {}) };
      }),
      steps: textToSteps(this.stepsText),
      description: this.description.trim(),
      image: this.image(),
      servings: Number(this.servings) || 4,
      prepTime: num(this.prepTime),
      cookTime: num(this.cookTime),
      cuisine: this.cuisine.trim() || null,
      mealTypes: this.selectedMeals(),
      diet: this.diet(),
      traditional: this.traditional,
      budget: this.budget(),
      tags: this.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
      tips: this.tips.split('\n').map(t => t.trim()).filter(Boolean),
      nutrition: num(this.calories) !== null ? { calories: num(this.calories) } : null,
      source: this.sourceUrl.trim() ? { url: this.sourceUrl.trim(), title: this.sourceTitle } : null,
      isPublic: this.isPublic,
    };
  }

  /** The user's aisle pick for an ingredient name, only for names the dictionary does not know. */
  private pickFor(name: string): Aisle | undefined {
    const c = this.checks()[name.trim()];
    return c && !c.known ? this.picks()[c.canonical] : undefined;
  }

  private fill(r: Recipe): void {
    this.storedAisles = Object.fromEntries(r.ingredients.filter(i => i.aisle).map(i => [i.name.trim(), i.aisle as Aisle]));
    this.name = r.name;
    this.ingredientsText.set(ingredientsToText(r.ingredients));
    this.stepsText = stepsToText(r.steps);
    this.description = r.description;
    this.servings = r.servings;
    this.prepTime = r.prepTime;
    this.cookTime = r.cookTime;
    this.cuisine = r.cuisine ?? '';
    this.selectedMeals.set([...r.mealTypes]);
    this.diet.set({ ...r.diet });
    this.traditional = r.traditional;
    this.budget.set(r.budget);
    this.tags = r.tags.join(', ');
    this.tips = r.tips.join('\n');
    this.calories = r.nutrition?.calories ?? null;
    this.sourceUrl = r.source?.url ?? '';
    this.sourceTitle = r.source?.title ?? null;
    this.isPublic = r.isPublic;
    this.image.set(r.image);
  }

  private applyDraft(d: RecipeDraft): void {
    this.name = d.name;
    this.ingredientsText.set(d.ingredientLines.join('\n'));
    this.stepsText = d.steps.join('\n\n');
    this.description = d.description;
    this.servings = d.servings;
    this.prepTime = d.prepTime;
    this.cookTime = d.cookTime ?? (d.totalTime !== null && d.prepTime !== null ? Math.max(0, d.totalTime - d.prepTime) : d.totalTime);
    this.cuisine = d.cuisine ?? '';
    this.selectedMeals.set(d.mealTypes);
    this.tags = d.tags.join(', ');
    this.calories = d.nutrition?.calories ?? null;
    this.sourceUrl = d.source.url ?? '';
    this.sourceTitle = d.source.title ?? null;
    this.isPublic = d.isPublic; // imported recipes default to private
    // Imported photos are hotlinks on someone else's site: keep them out; the user can add one.
    this.image.set('');
  }
}

const DRAFT_KEY = 'mise_recipe_draft';

interface EditorDraft {
  name?: string;
  ingredientsText?: string;
  stepsText?: string;
  description?: string;
  servings?: number;
  prepTime?: number | null;
  cookTime?: number | null;
  cuisine?: string;
  tags?: string;
  tips?: string;
  sourceUrl?: string;
  image?: string;
  mealTypes?: MealType[];
  traditional?: boolean;
  budget?: Budget | null;
  diet?: Partial<DietFlags>;
  isPublic?: boolean;
}

function readDraft(): EditorDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as EditorDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: EditorDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // storage full/blocked: autosave is a convenience only
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}
