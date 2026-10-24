import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AVATAR_TINTS, IconComponent, hash } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { CuisineSummary, RecipeService } from '../../services';
import { optimizeImage } from '../../utils/image-url';

/** Region display order (content schema regions), then anything else. */
export const REGION_ORDER = [
  'North Africa & Middle East',
  'Sub-Saharan Africa',
  'Europe',
  'South Asia',
  'East Asia',
  'Southeast Asia',
  'Americas',
];

export interface RegionGroup {
  region: string;
  cuisines: CuisineSummary[];
}

/** Cuisines grouped by region in REGION_ORDER, alphabetical inside a region. */
export function groupByRegion(cuisines: CuisineSummary[]): RegionGroup[] {
  const map = new Map<string, CuisineSummary[]>();
  for (const c of cuisines) {
    const region = c.region ?? 'Other';
    map.set(region, [...(map.get(region) ?? []), c]);
  }
  const rank = (r: string) => (REGION_ORDER.indexOf(r) === -1 ? REGION_ORDER.length : REGION_ORDER.indexOf(r));
  return [...map.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([region, list]) => ({ region, cuisines: [...list].sort((x, y) => x.name.localeCompare(y.name)) }));
}

/** /cuisines (public): every cuisine, grouped by region, with a photo (or tinted monogram)
 *  and its recipe count. */
@Component({
  selector: 'app-cuisines',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/" class="btn-ghost -ms-3"><app-icon name="arrow-left" [size]="18" /> {{ t('cuisines.back') }}</a>
      <h1 class="page-title mt-2">{{ t('cuisines.title') }}</h1>
      <p class="mt-1 text-muted">{{ t('cuisines.summary', { cuisines: recipes.cuisines().length, regions: groups().length }) }}</p>

      @if (!recipes.recipesLoaded()) {
        <div class="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-5">@for (i of [1, 2, 3, 4, 5, 6]; track i) { <div class="skeleton aspect-square rounded-full"></div> }</div>
      }
      @for (g of groups(); track g.region) {
        <section class="mt-8" [attr.aria-labelledby]="'region-' + $index">
          <h2 [id]="'region-' + $index" class="section-title">{{ i18n.region(g.region) }}</h2>
          <ul class="mt-3 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5 lg:grid-cols-7">
            @for (c of g.cuisines; track c.slug) {
              <li>
                <a [routerLink]="['/cuisines', c.slug]" class="flex flex-col items-center gap-1.5 text-center">
                  @if (photo(c); as img) {
                    <img [src]="img" alt="" loading="lazy" class="aspect-square w-full max-w-[96px] rounded-full object-cover shadow-soft" />
                  } @else {
                    <span class="flex aspect-square w-full max-w-[96px] items-center justify-center rounded-full font-display text-2xl font-semibold text-white shadow-soft"
                          [style.background]="tint(c.name)" aria-hidden="true">{{ monogram(i18n.cuisine(c.name)) }}</span>
                  }
                  <span class="text-sm font-medium leading-tight">{{ i18n.cuisine(c.name) }}</span>
                  <span class="text-xs text-muted">{{ t('common.recipes', { count: c.count }) }}</span>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class CuisinesComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly recipes = inject(RecipeService);
  /** Regions in the fixed order; cuisines sorted by their name in the active language. */
  readonly groups = computed(() =>
    groupByRegion(this.recipes.cuisines()).map(g => ({
      ...g,
      cuisines: [...g.cuisines].sort((a, b) => this.i18n.cuisine(a.name).localeCompare(this.i18n.cuisine(b.name), this.i18n.language())),
    }))
  );

  photo(c: CuisineSummary): string {
    const pick = this.recipes.recipes().find(r => r.cuisine === c.name && r.image && r.traditional) ??
      this.recipes.recipes().find(r => r.cuisine === c.name && r.image);
    return pick ? optimizeImage(pick.image, 240) : '';
  }

  monogram(name: string): string {
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  tint(name: string): string {
    return AVATAR_TINTS[hash(name) % AVATAR_TINTS.length];
  }
}
