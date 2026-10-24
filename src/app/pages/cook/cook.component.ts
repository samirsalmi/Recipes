import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyStateComponent, IconComponent } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { Ingredient, Recipe } from '../../models';
import { RecipeService, TimerService, ToastService } from '../../services';
import { formatQuantity } from '../../utils/ingredient-parser';
import { equivalentName } from '../../utils/unit-equivalent';
import { StepPart, splitStepTimers } from '../../utils/timers';

/** Ingredients a step mentions (by name or its last word, e.g. "onions" for "red onion"). The
 *  step is matched against the name as typed and, for known ingredients, against its English,
 *  French and Arabic dictionary names, so a French step finds an ingredient typed in English. */
export function stepIngredients(stepText: string, ingredients: Ingredient[]): Ingredient[] {
  const text = stepText.toLowerCase();
  return ingredients.filter(i => {
    const candidates = [i.name, ...(i.names ? [i.names.en, i.names.fr, i.names.ar] : [])];
    return candidates.some(candidate => {
      const name = candidate.toLowerCase().split(',')[0].trim();
      if (!name) return false;
      const words = name.split(/\s+/);
      const head = words[words.length - 1].replace(/(es|s)$/, '');
      return text.includes(name) || (head.length > 2 && text.includes(head));
    });
  });
}

/** /cook/:id (public): one step per screen, big type, swipe or arrow keys, the step's
 *  ingredients, tappable timers (several can run at once; the global timer tray shows them),
 *  and a Screen Wake Lock so the phone doesn't sleep. */
@Component({
  selector: 'app-cook',
  standalone: true,
  imports: [RouterLink, IconComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (recipe(); as r) {
      <div class="page flex min-h-[calc(100dvh-4rem)] flex-col lg:min-h-[calc(100dvh-8rem)]"
           (touchstart)="touchStart($event)" (touchend)="touchEnd($event)">
        <header class="flex items-center gap-3">
          <a [routerLink]="['/recipes', r.id]" class="btn-icon -ms-2" [attr.aria-label]="t('cook.leave')"><app-icon name="x" /></a>
          <div class="min-w-0 flex-1">
            <p class="eyebrow">{{ t('cook.stepOf', { n: index() + 1, total: r.steps.length }) }}</p>
            <p class="truncate font-display text-lg font-semibold" dir="auto">{{ i18n.recipeName(r) }}</p>
          </div>
          @if (wakeLocked()) { <span class="chip-quiet" [title]="t('cook.screenOnTitle')">{{ t('cook.screenOn') }}</span> }
        </header>
        <div class="mt-4 flex gap-1" aria-hidden="true">
          @for (s of r.steps; track $index) {
            <span class="h-1.5 flex-1 rounded-full" [class.bg-primary]="$index <= index()" [class.bg-sunken]="$index > index()"></span>
          }
        </div>

        <div class="my-auto py-8">
          <p class="font-display text-2xl leading-snug sm:text-4xl" aria-live="polite" dir="auto">
            @for (part of parts(); track $index) {
              @if (part.timer) {
                <button type="button" class="mx-0.5 inline-flex items-center gap-1.5 rounded-full bg-saffron/30 px-3 py-0.5 font-sans text-xl font-semibold text-ink hover:bg-saffron/50 sm:text-2xl"
                        (click)="startTimer(part, r)" [attr.aria-label]="t('timers.startFor', { text: part.text })"><app-icon name="timer" [size]="20" />{{ part.text }}</button>
              } @else {<span>{{ part.text }}</span>}
            }
          </p>
          @if (stepIngs().length) {
            <ul class="mt-6 flex flex-wrap gap-2" [attr.aria-label]="t('cook.ingredientsFor')">
              @for (ing of stepIngs(); track $index) {
                <li class="chip-quiet text-sm">{{ amount(ing) }} <bdi>{{ i18n.ingredientName(ing) }}</bdi>@if (equivalent(ing); as eq) { <bdi class="text-muted" data-qa="unit-equivalent">{{ eq }}</bdi> }</li>
              }
            </ul>
          }
          @if (r.steps[index()].timerMinutes && !hasInlineTimer()) {
            <button type="button" class="btn-secondary mt-6" (click)="startPlain(r)"><app-icon name="timer" [size]="18" /> {{ t('cook.startTimer', { minutes: r.steps[index()].timerMinutes! }) }}</button>
          }
        </div>

        <div class="flex gap-3 pb-2">
          <button type="button" class="btn-secondary flex-1" (click)="go(-1)" [disabled]="index() === 0">
            <app-icon name="chevron-left" [size]="18" /> {{ t('cook.back') }}
          </button>
          @if (index() < r.steps.length - 1) {
            <button type="button" class="btn-primary flex-1" (click)="go(1)">{{ t('cook.next') }} <app-icon name="chevron-right" [size]="18" /></button>
          } @else {
            <a [routerLink]="['/recipes', r.id]" class="btn-primary flex-1">{{ t('cook.done') }} <app-icon name="check" [size]="18" /></a>
          }
        </div>
        <p class="hidden text-center text-xs text-muted lg:block">{{ t('cook.arrowTip') }}</p>
      </div>
    } @else if (missing()) {
      <div class="page">
        <app-empty-state icon="pot" [title]="t('cook.nothing')" [text]="t('cook.noSteps')">
          <a routerLink="/" class="btn-primary">{{ t('detail.backDiscover') }}</a>
        </app-empty-state>
      </div>
    } @else {
      <div class="page space-y-4" aria-busy="true"><div class="skeleton h-6 w-1/2"></div><div class="skeleton h-40"></div></div>
    }
  `,
})
export class CookComponent implements OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  private recipes = inject(RecipeService);
  private timers = inject(TimerService);
  private toast = inject(ToastService);
  readonly id = input.required<string>();

  readonly recipe = signal<Recipe | null>(null);
  readonly missing = signal(false);
  readonly index = signal(0);
  readonly wakeLocked = signal(false);
  readonly parts = computed<StepPart[]>(() => {
    const r = this.recipe();
    return r ? splitStepTimers(this.i18n.recipeSteps(r)[this.index()] ?? '') : [];
  });
  readonly hasInlineTimer = computed(() => this.parts().some(p => !!p.timer));
  readonly stepIngs = computed(() => {
    const r = this.recipe();
    return r ? stepIngredients(this.i18n.recipeSteps(r)[this.index()] ?? '', r.ingredients) : [];
  });
  private wakeLock: { release(): Promise<void> } | null = null;
  private resolving: string | null = null;
  private touchX: number | null = null;
  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.recipe()) this.requestWakeLock();
  };

  constructor() {
    effect(() => {
      const id = this.id();
      const loaded = this.recipes.recipesLoaded();
      const found = this.recipes.recipes().find(r => r.id === id);
      untracked(() => {
        if (found) {
          this.recipe.set(found.steps.length ? found : null);
          this.missing.set(!found.steps.length);
          if (found.steps.length) this.requestWakeLock();
        } else if (loaded && this.resolving !== id) {
          this.resolving = id;
          this.recipes.resolveRecipe(id).subscribe(r => !r && this.missing.set(true));
        }
      });
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  go(delta: number): void {
    const count = this.recipe()?.steps.length ?? 0;
    this.index.update(i => Math.min(count - 1, Math.max(0, i + delta)));
  }

  amount(ing: Ingredient): string {
    return ing.quantity === null ? '' : this.i18n.amount(formatQuantity(ing.quantity), ing.unit && ing.unit !== 'piece' ? ing.unit : null, ing.quantity);
  }

  equivalent(ing: Ingredient): string {
    return this.i18n.equivalent(ing.quantity, ing.unit, equivalentName(ing), true);
  }

  startTimer(part: StepPart, r: Recipe): void {
    if (!part.timer) return;
    this.timers.start(this.t('timers.step', { n: this.index() + 1, text: part.text }), part.timer.minutes, this.i18n.recipeName(r));
    this.toast.show(this.t('timers.started', { text: part.text }));
  }

  startPlain(r: Recipe): void {
    const minutes = r.steps[this.index()].timerMinutes;
    if (minutes) this.timers.start(this.t('timers.stepOnly', { n: this.index() + 1 }), minutes, this.i18n.recipeName(r));
  }

  touchStart(e: TouchEvent): void {
    this.touchX = e.changedTouches[0]?.clientX ?? null;
  }

  touchEnd(e: TouchEvent): void {
    if (this.touchX === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? this.touchX) - this.touchX;
    this.touchX = null;
    // Swiping toward the start of the line (left in LTR, right in RTL) goes forward.
    const forward = this.i18n.isRtl() ? dx > 0 : dx < 0;
    if (Math.abs(dx) > 60) this.go(forward ? 1 : -1);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    const next = this.i18n.isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const prev = this.i18n.isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === next) this.go(1);
    if (event.key === prev) this.go(-1);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.wakeLock?.release().catch(() => undefined);
  }

  private requestWakeLock(): void {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener?: (t: string, cb: () => void) => void }> } };
    if (!nav.wakeLock) return;
    nav.wakeLock.request('screen').then(lock => {
      this.wakeLock = lock;
      this.wakeLocked.set(true);
      lock.addEventListener?.('release', () => this.wakeLocked.set(false));
    }).catch(() => this.wakeLocked.set(false));
  }
}
