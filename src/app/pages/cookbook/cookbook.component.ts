import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EmptyStateComponent, IconComponent, RecipeCardComponent } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { Collection, Recipe } from '../../models';
import { CollectionService, FavoritesService, RecipeService, ToastService } from '../../services';
import { optimizeImage } from '../../utils/image-url';

type Tab = 'favorites' | 'mine' | 'collections';

/** /cookbook: Favorites (yours + "loved by your household"), My recipes (your own and your
 *  copies, any visibility), Collections (simple named lists: create, open, rename, delete;
 *  recipes are added from the recipe page's menu). "Add recipe" button. */
@Component({
  selector: 'app-cookbook',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, RecipeCardComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="flex items-center justify-between gap-4">
        <h1 class="page-title">{{ t('book.title') }}</h1>
        <a routerLink="/recipes/new" class="btn-primary hidden sm:inline-flex"><app-icon name="plus" [size]="18" /> {{ t('book.addRecipe') }}</a>
      </header>
      <div class="mt-5 flex gap-2" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="chip" [class.chip-active]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="setTab(t.id)">
            {{ tabLabel(t.id) }} <span class="opacity-70">{{ count(t.id) }}</span>
          </button>
        }
      </div>

      @switch (tab()) {
        @case ('favorites') {
          @if (!recipes.recipesLoaded()) {
            <div class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">@for (i of [1, 2, 3]; track i) { <div class="skeleton aspect-[4/3]"></div> }</div>
          } @else {
            <div class="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              @for (r of myFavorites(); track r.id) {
                <app-recipe-card [recipe]="r" [isFavorite]="true" (favoriteToggled)="favorites.toggleFavorite($event)" />
              }
            </div>
            @if (!myFavorites().length) {
              <app-empty-state icon="heart" [title]="i18n.t('book.noFav')" [text]="i18n.t('book.noFavText')">
                <a routerLink="/" class="btn-primary">{{ i18n.t('book.discover') }}</a>
              </app-empty-state>
            }
            @if (householdOnly().length) {
              <section class="mt-10">
                <h2 class="section-title">{{ i18n.t('book.lovedBy') }}</h2>
                <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
                  @for (h of householdOnly(); track h.recipe.id) {
                    <div>
                      <app-recipe-card [recipe]="h.recipe" [isFavorite]="false" (favoriteToggled)="favorites.toggleFavorite($event)" />
                      <p class="mt-1 text-xs text-muted">♥ {{ h.names }}</p>
                    </div>
                  }
                </div>
              </section>
            }
          }
        }
        @case ('mine') {
          @if (mine() === null) {
            <div class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">@for (i of [1, 2]; track i) { <div class="skeleton aspect-[4/3]"></div> }</div>
          } @else {
            <ul class="mt-6 divide-y divide-hairline rounded-card border border-hairline bg-surface">
              @for (r of mine()!; track r.id) {
                <li class="flex items-center gap-3 p-3">
                  <a [routerLink]="['/recipes', r.id]" class="flex min-w-0 flex-1 items-center gap-3">
                    @if (r.image) {
                      <img [src]="thumb(r.image)" alt="" class="h-14 w-14 shrink-0 rounded-xl object-cover" />
                    } @else {
                      <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary"><app-icon name="pot" /></span>
                    }
                    <span class="min-w-0">
                      <span class="block truncate font-medium" dir="auto">{{ i18n.recipeName(r) }}</span>
                      <span class="block text-xs text-muted">
                        {{ r.isPublic ? i18n.t('book.public') : i18n.t('book.privateLabel') }}{{ r.parentRecipeId ? ' · ' + i18n.t('book.yourCopy') : '' }}{{ r.cuisine ? ' · ' + i18n.cuisine(r.cuisine) : '' }}
                      </span>
                    </span>
                  </a>
                  <a [routerLink]="['/recipes', r.id, 'edit']" class="btn-icon" [attr.aria-label]="i18n.t('book.editAria', { name: i18n.recipeName(r) })"><app-icon name="edit" [size]="18" /></a>
                </li>
              }
            </ul>
            @if (!mine()!.length) {
              <app-empty-state icon="edit" [title]="i18n.t('book.mineEmpty')" [text]="i18n.t('book.mineEmptyText')">
                <a routerLink="/recipes/new" class="btn-primary">{{ i18n.t('book.addARecipe') }}</a>
              </app-empty-state>
            }
          }
        }
        @case ('collections') {
          @if (open(); as c) {
            <div class="mt-6">
              <button type="button" class="btn-ghost -ms-3" (click)="openId.set(null)"><app-icon name="arrow-left" [size]="18" /> {{ i18n.t('book.allCollections') }}</button>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                @if (renaming()) {
                  <form class="flex flex-1 gap-2" (ngSubmit)="rename(c)">
                    <input name="rename" class="input" [(ngModel)]="renameValue" dir="auto" />
                    <button type="submit" class="btn-primary" [disabled]="!renameValue.trim()">{{ i18n.t('common.save') }}</button>
                  </form>
                } @else {
                  <h2 class="font-display text-2xl font-semibold" dir="auto">{{ c.name }}</h2>
                  <button type="button" class="btn-icon" (click)="startRename(c)" [attr.aria-label]="i18n.t('book.renameAria')"><app-icon name="edit" [size]="18" /></button>
                  <button type="button" class="btn-icon text-accent" (click)="deleteCollection(c)" [attr.aria-label]="i18n.t('book.deleteAria')"><app-icon name="trash" [size]="18" /></button>
                }
              </div>
              <div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
                @for (r of openRecipes(); track r.id) {
                  <div class="relative">
                    <app-recipe-card [recipe]="r" [showFavorite]="false" />
                    <button type="button" class="photo-pill absolute end-2 top-2" (click)="collections.removeRecipeFromCollection(c.id, r.id)">{{ i18n.t('book.removeFromCollection') }}</button>
                  </div>
                }
              </div>
              @if (!openRecipes().length) {
                <app-empty-state icon="folder" [title]="i18n.t('book.emptyCollection')" [text]="i18n.t('book.emptyCollectionText')" />
              }
            </div>
          } @else {
            <form class="mt-6 flex gap-2" (ngSubmit)="createCollection()">
              <input name="newCollection" class="input" [placeholder]="i18n.t('book.newCollection')" [(ngModel)]="newCollection" dir="auto" />
              <button type="submit" class="btn-primary shrink-0" [disabled]="!newCollection.trim()">{{ i18n.t('common.create') }}</button>
            </form>
            <div class="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              @for (c of collections.collections(); track c.id) {
                <button type="button" class="text-start" (click)="openId.set(c.id)">
                  <span class="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-card bg-sunken">
                    @for (img of covers(c); track $index) {
                      <img [src]="thumb(img)" alt="" class="h-full w-full object-cover" />
                    }
                  </span>
                  <span class="mt-2 block font-display text-lg font-semibold" dir="auto">{{ c.name }}</span>
                  <span class="block text-sm text-muted">{{ i18n.t('common.recipes', { count: c.recipeIds.length }) }}</span>
                </button>
              }
            </div>
            @if (!collections.collections().length) {
              <app-empty-state icon="folder" [title]="i18n.t('book.noCollections')" [text]="i18n.t('book.noCollectionsText')" />
            }
          }
        }
      }
    </div>

    <a routerLink="/recipes/new" class="btn-primary fixed end-4 z-20 h-14 w-14 rounded-full p-0 shadow-soft sm:hidden"
       style="bottom: calc(4.75rem + var(--safe-bottom))" [attr.aria-label]="i18n.t('book.addRecipe')"><app-icon name="plus" [size]="26" /></a>
  `,
})
export class CookbookComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly favorites = inject(FavoritesService);
  readonly recipes = inject(RecipeService);
  readonly collections = inject(CollectionService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly tabs: { id: Tab }[] = [{ id: 'favorites' }, { id: 'mine' }, { id: 'collections' }];
  readonly tab = signal<Tab>('favorites');
  readonly mine = signal<Recipe[] | null>(null);
  readonly openId = signal<string | null>(null);
  readonly renaming = signal(false);
  newCollection = '';
  renameValue = '';

  readonly myFavorites = computed(() => this.recipes.getRecipesByIds([...this.favorites.myFavoriteIds()]));
  readonly householdOnly = computed(() => {
    const mine = this.favorites.myFavoriteIds();
    const out: { recipe: Recipe; names: string }[] = [];
    for (const [id, names] of this.favorites.householdFavorites()) {
      const recipe = this.recipes.getRecipeById(id);
      if (recipe && !mine.has(id)) out.push({ recipe, names: names.join(', ') });
    }
    return out;
  });
  readonly open = computed<Collection | null>(() => this.collections.collections().find(c => c.id === this.openId()) ?? null);
  readonly openRecipes = computed(() => {
    const c = this.open();
    return c ? this.recipes.getRecipesByIds(c.recipeIds) : [];
  });

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    this.setTab(tab && this.tabs.some(t => t.id === tab) ? tab : 'favorites');
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.router.navigate([], { queryParams: { tab: tab === 'favorites' ? null : tab }, replaceUrl: true });
    if (tab === 'mine' && this.mine() === null) this.recipes.loadMyRecipes().subscribe(list => this.mine.set(list));
  }

  tabLabel(tab: Tab): string {
    return this.i18n.t(`book.tab.${tab}`);
  }

  count(tab: Tab): string {
    const n = tab === 'favorites' ? this.favorites.myFavoriteIds().size : tab === 'mine' ? (this.mine()?.length ?? 0) : this.collections.collections().length;
    return n ? this.i18n.n(n) : '';
  }

  thumb(url: string): string {
    return optimizeImage(url, 240);
  }

  covers(c: Collection): string[] {
    return this.recipes.getRecipesByIds(c.recipeIds).map(r => r.image).filter(Boolean).slice(0, 4);
  }

  createCollection(): void {
    const name = this.newCollection.trim();
    if (!name) return;
    const c = this.collections.createCollection(name);
    this.newCollection = '';
    this.openId.set(c.id);
  }

  startRename(c: Collection): void {
    this.renameValue = c.name;
    this.renaming.set(true);
  }

  rename(c: Collection): void {
    this.collections.updateCollection(c.id, { name: this.renameValue.trim() });
    this.renaming.set(false);
  }

  deleteCollection(c: Collection): void {
    if (!confirm(this.i18n.t('book.confirmDelete', { name: c.name }))) return;
    this.collections.deleteCollection(c.id);
    this.openId.set(null);
    this.toast.show(this.i18n.t('book.deleted'));
  }
}
