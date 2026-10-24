import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import { Recipe } from '../../models';
import { optimizeImage } from '../../utils/image-url';
import { IconComponent } from '../icon/icon.component';
import { ImagePlaceholderComponent } from '../ui/image-placeholder/image-placeholder.component';

/** Photo-led recipe card: 4:3 image (solid "Budget" pill on low-budget dishes), name,
 *  cuisine + time + budget signs, heart. (Traditional is shown on the detail page and as a
 *  filter/shelf, not on cards - nearly all curated recipes are traditional.) The
 *  image carries a view-transition-name so it morphs into the detail page hero. */
@Component({
  selector: 'app-recipe-card',
  standalone: true,
  imports: [RouterLink, IconComponent, ImagePlaceholderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="group relative [content-visibility:auto] [contain-intrinsic-size:auto_260px]">
      <a [routerLink]="['/recipes', recipe().id]" class="block rounded-card focus-visible:outline-offset-4">
        <div class="relative aspect-[4/3] overflow-hidden rounded-card bg-sunken">
          @if (recipe().image && !imageFailed()) {
            <img [src]="image()" [alt]="name()" loading="lazy" decoding="async"
                 class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                 [style.view-transition-name]="'recipe-' + recipe().id" (error)="imageFailed.set(true)" />
          } @else {
            <app-image-placeholder />
          }
          @if (recipe().budget === 'low') {
            <span class="photo-pill absolute bottom-2.5 start-2.5"><app-icon name="coins" [size]="13" /> {{ t('card.budget') }}</span>
          }
        </div>
        <h3 dir="auto" class="mt-2.5 line-clamp-2 font-display text-lg font-semibold leading-snug">{{ name() }}</h3>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
          @if (recipe().cuisine) {
            <span>{{ i18n.cuisine(recipe().cuisine!) }}</span>
          }
          @if (recipe().totalTime) {
            <span class="inline-flex items-center gap-1"><app-icon name="clock" [size]="14" />{{ t('common.minutes', { count: recipe().totalTime! }) }}</span>
          }
          @if (budgetLabel() && recipe().budget !== 'low') {
            <span class="inline-flex items-center gap-0.5" [attr.aria-label]="budgetLabel()" [title]="budgetLabel()">
              <app-icon name="coins" [size]="14" />{{ budgetSigns() }}
            </span>
          }
        </p>
      </a>
      @if (showFavorite()) {
        <button type="button" (click)="favoriteToggled.emit(recipe().id)"
                class="absolute end-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-soft backdrop-blur-sm"
                [class.text-accent]="isFavorite()"
                [attr.aria-pressed]="isFavorite()" [attr.aria-label]="isFavorite() ? t('card.removeFavorite') : t('card.addFavorite')">
          <app-icon name="heart" [size]="20" [filled]="isFavorite()" />
        </button>
      }
    </article>
  `,
})
export class RecipeCardComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly recipe = input.required<Recipe>();
  readonly isFavorite = input(false);
  readonly showFavorite = input(true);
  readonly favoriteToggled = output<string>();

  readonly imageFailed = signal(false);
  readonly image = computed(() => optimizeImage(this.recipe().image, 640));
  readonly budgetSigns = computed(() => ({ low: '$', medium: '$$', high: '$$$' })[this.recipe().budget ?? 'medium']);
  readonly name = computed(() => this.i18n.recipeName(this.recipe()));
  readonly budgetLabel = computed(() => {
    const b = this.recipe().budget;
    return b ? this.t('card.budgetLabel', { level: this.i18n.budgetLevel(b) }) : '';
  });
}
