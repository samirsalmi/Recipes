import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import { Recipe } from '../../models';
import { RecipeService } from '../../services';

interface SourceGroup {
  title: string;
  url: string | null;
  license: string;
  recipes: Recipe[];
}

/** /credits (public): where every curated recipe comes from (grouped by source book or
 *  collection, with license) and every photo's author, license and file page. */
@Component({
  selector: 'app-credits',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page max-w-3xl">
      <p class="eyebrow">{{ t('cred.eyebrow') }}</p>
      <h1 class="page-title mt-1">{{ t('cred.title') }}</h1>
      <p class="mt-3 leading-relaxed text-muted">{{ t('cred.intro') }}</p>

      @if (!recipes.recipesLoaded()) {
        <div class="mt-8 space-y-3" aria-busy="true">@for (i of [1, 2, 3]; track i) { <div class="skeleton h-20"></div> }</div>
      } @else {
        <h2 class="section-title mt-10">{{ t('cred.sources', { count: groups().length }) }}</h2>
        <ul class="mt-3 space-y-3">
          @for (g of groups(); track g.title) {
            <li class="card p-4">
              <p class="font-semibold">
                @if (g.url) { <a [href]="g.url" target="_blank" rel="noopener" class="hover:underline" dir="auto">{{ sourceTitle(g.title) }}</a> } @else { {{ sourceTitle(g.title) }} }
              </p>
              <p class="text-sm text-muted">{{ t('cred.licenseLine', { license: g.license, recipes: t('common.recipes', { count: g.recipes.length }) }) }}</p>
              <p class="mt-2 text-sm">
                @for (r of g.recipes; track r.id; let last = $last) {
                  <a [routerLink]="['/recipes', r.id]" class="text-primary hover:underline" dir="auto">{{ i18n.recipeName(r) }}</a>{{ last ? '' : t('common.listSeparator') + ' ' }}
                }
              </p>
            </li>
          }
        </ul>

        @if (original().length) {
          <h2 class="section-title mt-10">{{ t('cred.written') }}</h2>
          <p class="mt-1 text-sm text-muted">{{ t('cred.writtenText') }}</p>
          <ul class="mt-3 divide-y divide-hairline text-sm">
            @for (r of original(); track r.id) {
              <li class="py-2.5">
                <a [routerLink]="['/recipes', r.id]" class="font-medium hover:underline" dir="auto">{{ i18n.recipeName(r) }}</a>
                @if (r.source?.adaptation) { <span class="text-muted"> - {{ r.source!.adaptation }}</span> }
                @if (r.source?.url) { · <a [href]="r.source!.url" target="_blank" rel="noopener" class="text-muted underline">{{ t('cred.reference') }}</a> }
              </li>
            }
          </ul>
        }

        <h2 class="section-title mt-10">{{ t('cred.photos') }}</h2>
        <ul class="mt-3 divide-y divide-hairline text-sm">
          @for (r of withPhotoCredit(); track r.id) {
            <li class="py-2.5">
              <a [routerLink]="['/recipes', r.id]" class="font-medium hover:underline" dir="auto">{{ i18n.recipeName(r) }}</a>
              <span class="text-muted"> - {{ r.imageCredit!.author }}, {{ r.imageCredit!.license }}</span>
              @if (r.imageCredit!.pageUrl) { · <a [href]="r.imageCredit!.pageUrl" target="_blank" rel="noopener" class="text-muted underline">{{ t('cred.filePage') }}</a> }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class CreditsComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly recipes = inject(RecipeService);

  private readonly curated = computed(() =>
    this.recipes.recipes().filter(r => r.ownerId === null).sort((a, b) => a.name.localeCompare(b.name))
  );

  readonly groups = computed<SourceGroup[]>(() => {
    const map = new Map<string, SourceGroup>();
    for (const r of this.curated()) {
      if (r.source?.license === 'Original') continue; // listed under "Written for Mise"
      const title = r.source?.title ?? 'Other sources';
      const g = map.get(title) ?? { title, url: r.source?.url ?? null, license: r.source?.license ?? '', recipes: [] };
      g.recipes.push(r);
      map.set(title, g);
    }
    return [...map.values()].sort((a, b) => b.recipes.length - a.recipes.length || a.title.localeCompare(b.title));
  });

  /** Recipes with no free source, written from the traditional method (license "Original"). */
  readonly original = computed(() => this.curated().filter(r => r.source?.license === 'Original'));

  sourceTitle(title: string): string {
    return title === 'Other sources' ? this.t('cred.otherSources') : title;
  }

  readonly withPhotoCredit = computed(() => this.curated().filter(r => r.imageCredit));
}
