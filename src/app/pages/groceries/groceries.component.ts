import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BottomSheetComponent, EmptyStateComponent, GroceryItemComponent, HaveChange, IconComponent, itemAmountLabel } from '../../components';
import { I18nService } from '../../i18n/i18n.service';
import { Aisle, AtHomeEntry, GroceryItem, GroceryPart } from '../../models';
import { GroceriesService, HouseholdService, ToastService } from '../../services';
import { addDays, startOfWeek, todayIso } from '../../utils/dates';
import { GroceryPdfModel, buildGroceryPdfModel, groceryPdfModelToText } from '../../utils/grocery-pdf-model';
import { copyText, downloadBlob, openBlob, shareFile } from '../../utils/share';

const AISLE_ICONS: Record<Aisle, string> = {
  produce: 'leaf', 'meat-fish': 'fish', 'dairy-eggs': 'egg', bakery: 'bread', pantry: 'jar',
  spices: 'spice', frozen: 'snowflake', drinks: 'cup', household: 'spray', other: 'dots',
};

type Sheet = 'range' | 'new-shop' | 'share' | null;

/** /groceries: the household's live shop. Header range chip ("Tue 20 - Sun 25 · 9 meals",
 *  tap to change), progress, share / export (PDF, text), start a new shop. Quick-add extras. Items grouped
 *  by aisle (fixed order, icons): to buy first, "+N more needed" when the plan grew, a "new"
 *  dot for other members' additions, tap to see where an item comes from; checked items sink
 *  into the cart. Then "No longer needed - already bought", optional extras from the recipes
 *  (one tap adds them) and the collapsed pantry staples. Partner check-offs arrive live. */
@Component({
  selector: 'app-groceries',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, GroceryItemComponent, BottomSheetComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page max-w-3xl lg:max-w-5xl">
      <header>
        <p class="eyebrow">{{ t('groc.eyebrow', { name: household.household()?.name ?? t('groc.yourKitchen') }) }}</p>
        <div class="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 class="page-title">{{ t('groc.title') }}</h1>
          <div class="flex gap-1">
            <button type="button" class="btn-icon" (click)="openShare()" [attr.aria-label]="t('groc.shareAria')" data-qa="share-open"><app-icon name="share" /></button>
            <button type="button" class="btn-icon" (click)="openNewShop()" [attr.aria-label]="t('groc.newShopAria')"><app-icon name="plus" /></button>
          </div>
        </div>
        @if (g.stale()) {
          <p class="mt-3 rounded-xl bg-sunken px-3 py-2 text-sm text-muted" role="status" data-qa="stale-note">{{ t('groc.stale') }}</p>
        }
        @if (g.list(); as list) {
          <button type="button" class="chip mt-3" (click)="openRange()" data-qa="range-chip">
            <app-icon name="plan" [size]="16" /> {{ t('groc.rangeChip', { range: range(), meals: t('common.meals', { count: list.trip.mealCount }) }) }}
            <app-icon name="chevron-down" [size]="14" />
          </button>
          @if (list.progress.total) {
            <div class="mt-4 flex items-center gap-3">
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" [attr.aria-valuenow]="list.progress.done" aria-valuemin="0" [attr.aria-valuemax]="list.progress.total" [attr.aria-label]="t('groc.progress')">
                <div class="h-full rounded-full bg-primary transition-all duration-500" [style.width.%]="(list.progress.done / list.progress.total) * 100"></div>
              </div>
              <span class="text-sm tabular-nums text-muted" dir="ltr">{{ i18n.digits(list.progress.done + '/' + list.progress.total) }}</span>
            </div>
          }
        }
      </header>

      <form class="mt-5 flex gap-2" (ngSubmit)="addExtra()">
        <label class="sr-only" for="extra-name">{{ t('groc.addLabel') }}</label>
        <input id="extra-name" name="extra" class="input" [placeholder]="t('groc.addPlaceholder')" autocomplete="off" [(ngModel)]="extraName" dir="auto" />
        <button type="submit" class="btn-primary shrink-0 px-4" [disabled]="!extraName.trim()" [attr.aria-label]="t('groc.addItem')"><app-icon name="plus" /></button>
      </form>

      @if (!g.loaded()) {
        <div class="mt-6 space-y-3" aria-busy="true">@for (i of [1, 2, 3, 4]; track i) { <div class="skeleton h-14"></div> }</div>
      } @else {
        @if (allDone()) {
          <div class="mt-6 flex items-center gap-3 rounded-card bg-primary-tint p-4 text-primary animate-rise-in">
            <app-icon name="check" [size]="24" />
            <p class="font-semibold">{{ t('groc.allDone') }}</p>
          </div>
        }

        <div class="mt-6 lg:columns-2 lg:gap-6">
        @for (group of g.aisleGroups(); track group.aisle) {
          <section class="mb-6 break-inside-avoid" [attr.aria-labelledby]="'aisle-' + group.aisle">
            <h2 [id]="'aisle-' + group.aisle" class="flex items-center gap-2 text-sm font-semibold text-muted">
              <span class="flex h-7 w-7 items-center justify-center rounded-full bg-primary-tint text-primary"><app-icon [name]="aisleIcon(group.aisle)" [size]="16" /></span>
              {{ i18n.aisle(group.aisle) }} <span class="font-normal">({{ i18n.n(group.remaining) }})</span>
            </h2>
            <div class="mt-2 divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface">
              @for (item of group.items; track item.key) {
                <app-grocery-item [item]="item" [busy]="g.busyKeys().has(item.key)" (toggled)="toggle($event)"
                                  (haveChanged)="setHave($event.part, $event.change)" (stapleHave)="stapleHave($event)"
                                  (stapleAdd)="addToStaples($event)" (stapleRemove)="removeFromStaples($event)" />
              }
              @for (x of group.extras; track x.id) {
                <div class="flex items-center gap-1 px-2 py-1.5" [class.opacity-55]="x.checked">
                  <button type="button" role="checkbox" [attr.aria-checked]="x.checked" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                          (click)="g.toggleExtra(x).subscribe()" [attr.aria-label]="t(x.checked ? 'grocery.uncheck' : 'grocery.check', { name: i18n.ingredientName(x) })">
                    <span class="flex h-6 w-6 items-center justify-center rounded-full border-2" [class.border-primary]="x.checked" [class.bg-primary]="x.checked"
                          [class.text-primary-on]="x.checked" [class.border-hairline]="!x.checked">
                      @if (x.checked) { <app-icon name="check" [size]="16" /> }
                    </span>
                  </button>
                  <p class="min-w-0 flex-1 py-2 font-medium first-letter:uppercase" [class.line-through]="x.checked">
                    <bdi>{{ i18n.ingredientName(x) }}</bdi> @if (x.quantity) { <span class="text-sm font-normal text-muted">{{ x.quantity }}</span> }
                    <span class="ms-1 text-xs font-normal text-muted">{{ t('groc.extra') }}</span>
                  </p>
                  <button type="button" class="btn-icon h-10 w-10 text-muted" (click)="g.removeExtra(x.id).subscribe()" [attr.aria-label]="t('groc.removeAria', { name: i18n.ingredientName(x) })"><app-icon name="x" [size]="16" /></button>
                </div>
              }
            </div>
          </section>
        }
        </div>

        @if (!g.aisleGroups().length && !g.pantry().length) {
          <app-empty-state icon="groceries" [title]="t('groc.emptyTitle')" [text]="(g.list()?.trip?.mealCount ?? 0) ? t('groc.emptyNoNeed') : t('groc.emptyPlan')">
            <a routerLink="/plan" class="btn-primary">{{ t('groc.goPlan') }}</a>
            <button type="button" class="btn-secondary" (click)="openRange()">{{ t('groc.changeDates') }}</button>
          </app-empty-state>
        }

        @if (g.noLongerNeeded().length) {
          <section class="mt-8" aria-labelledby="nln-title">
            <h2 id="nln-title" class="text-sm font-semibold text-muted">{{ t('groc.nlnTitle') }}</h2>
            <p class="text-xs text-muted">{{ t('groc.nlnText') }}</p>
            <ul class="mt-2 space-y-1.5">
              @for (item of g.noLongerNeeded(); track item.key) {
                <li class="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-2 text-sm">
                  <span class="first-letter:uppercase"><bdi>{{ i18n.ingredientName(item) }}</bdi> @if (purchased(item); as bought) { <span class="text-muted">({{ bought }})</span> }</span>
                  <button type="button" class="btn-ghost min-h-[36px] px-3" (click)="g.unmark(item.key).subscribe()">{{ t('common.dismiss') }}</button>
                </li>
              }
            </ul>
          </section>
        }

        @if (g.optionalExtras().length) {
          <section class="mt-8" aria-labelledby="opt-title">
            <h2 id="opt-title" class="text-sm font-semibold text-muted">{{ t('groc.optTitle') }}</h2>
            <p class="text-xs text-muted">{{ t('groc.optText') }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              @for (o of g.optionalExtras(); track $index) {
                <button type="button" class="chip" (click)="addOptional(o)" [title]="t('groc.optFor', { recipe: o.recipeName })">
                  <app-icon name="plus" [size]="14" /> <span class="first-letter:uppercase"><bdi>{{ i18n.ingredientName(o) }}</bdi></span>
                  @if (optionalAmount(o); as amt) { <span class="text-muted">{{ amt }}</span> }
                </button>
              }
            </div>
          </section>
        }

        @if (g.atHome().length) {
          <section class="mt-8" aria-labelledby="home-title" data-qa="at-home-section">
            <h2 id="home-title" class="text-sm font-semibold text-muted">{{ t('have.memoryTitle') }}</h2>
            <p class="text-xs text-muted">{{ t('have.memoryText') }}</p>
            <ul class="mt-2 flex flex-wrap gap-2">
              @for (e of g.atHome(); track e.key) {
                <li class="chip gap-1 pe-1">
                  <span class="first-letter:uppercase"><bdi>{{ i18n.ingredientName(e) }}</bdi></span>
                  <span class="text-muted">{{ i18n.amountParts(e.haveAmount) }}</span>
                  <button type="button" class="btn-icon h-9 w-9" (click)="clearAtHome(e)" [attr.aria-label]="t('have.forget', { name: i18n.ingredientName(e) })" data-qa="at-home-clear"><app-icon name="x" [size]="14" /></button>
                </li>
              }
            </ul>
          </section>
        }

        @if (g.pantry().length) {
          <section class="mt-8" aria-labelledby="pantry-title" data-qa="pantry-section">
            <h2 id="pantry-title" class="text-sm font-semibold text-muted">{{ t('pantry.title', { count: g.pantry().length }) }}</h2>
            <p class="text-xs text-muted">{{ t('pantry.text') }}</p>
            <ul class="mt-2 divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface">
              @for (item of g.pantry(); track item.key) {
                <li class="flex items-center justify-between gap-1 ps-4 pe-1 py-1.5" [attr.data-qa]="'pantry-row'" [attr.data-state]="item.pantryState">
                  <span class="min-w-0 text-sm">
                    <span class="block truncate font-medium first-letter:uppercase"><bdi>{{ i18n.ingredientName(item) }}</bdi> <span class="ms-2 font-normal text-muted">{{ amountOf(item) }}</span></span>
                    @if (item.pantryState === 'need') {
                      <span class="mt-0.5 inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent" data-qa="pantry-state">{{ t('pantry.stateNeed') }}</span>
                    } @else {
                      <span class="mt-0.5 inline-flex rounded-full bg-primary-tint px-2 py-0.5 text-xs font-semibold text-primary" data-qa="pantry-state">{{ t('pantry.stateHave') }}</span>
                    }
                  </span>
                  @if (item.pantryState === 'need') {
                    <button type="button" class="btn-secondary min-h-[44px] shrink-0 px-3" (click)="stapleHave(item)" data-qa="staple-have">{{ t('pantry.iHaveIt') }}</button>
                  } @else {
                    <button type="button" class="btn-ghost min-h-[44px] shrink-0 px-3" (click)="stapleNeed(item)" data-qa="staple-need">{{ t('groc.iNeedIt') }}</button>
                  }
                  <button type="button" class="btn-icon h-11 w-11 shrink-0 text-muted" (click)="removeFromStaples(item)" data-qa="remove-staple"
                          [attr.aria-label]="t('staple.removeAria', { name: i18n.ingredientName(item) })"><app-icon name="x" [size]="16" /></button>
                </li>
              }
            </ul>
            <a routerLink="/household" fragment="staples" class="mt-2 block text-xs text-muted underline">{{ t('groc.editStaples') }}</a>
          </section>
        }
      }
    </div>

    @switch (sheet()) {
      @case ('range') {
        <app-bottom-sheet [title]="t('groc.rangeTitle')" (closed)="sheet.set(null)">
          <div class="space-y-4 pb-2">
            <div class="flex flex-wrap gap-2">
              @for (p of presets(); track p.label) {
                <button type="button" class="chip" [class.chip-active]="rangeStart === p.start && rangeEnd === p.end" (click)="rangeStart = p.start; rangeEnd = p.end">{{ p.label }}</button>
              }
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label" for="range-start">{{ t('groc.from') }}</label><input id="range-start" type="date" class="input" [(ngModel)]="rangeStart" /></div>
              <div><label class="label" for="range-end">{{ t('groc.to') }}</label><input id="range-end" type="date" class="input" [min]="rangeStart" [(ngModel)]="rangeEnd" /></div>
            </div>
            <button type="button" class="btn-primary w-full" (click)="applyRange()" [disabled]="!rangeStart || !rangeEnd || rangeEnd < rangeStart">{{ t('groc.update') }}</button>
          </div>
        </app-bottom-sheet>
      }
      @case ('share') {
        <app-bottom-sheet [title]="t('share.title')" (closed)="closeShare()">
          <div class="space-y-3 pb-2" data-qa="share-sheet">
            <p class="text-sm text-muted">{{ t('share.text') }}</p>
            <label class="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl bg-sunken px-4 py-2">
              <input type="checkbox" class="h-5 w-5 shrink-0 accent-[rgb(var(--primary))]" [checked]="includeChecked()" (change)="setIncludeChecked($any($event.target).checked)" data-qa="include-checked" />
              <span class="min-w-0"><span class="block font-medium">{{ t('share.includeChecked') }}</span><span class="block text-xs text-muted">{{ t('share.includeCheckedHint') }}</span></span>
            </label>
            <button type="button" class="btn-primary w-full" (click)="sharePdf()" [disabled]="pdfBusy() && !pdfFile()" data-qa="share-pdf">
              <app-icon name="share" [size]="18" /> {{ pdfBusy() && !pdfFile() ? t('share.preparing') : t('share.pdf') }}
            </button>
            <button type="button" class="btn-secondary w-full" (click)="downloadPdf()" [disabled]="pdfBusy() && !pdfFile()" data-qa="download-pdf">{{ t('share.download') }}</button>
            <button type="button" class="btn-secondary w-full" (click)="copyAsText()" data-qa="copy-text">{{ t('share.copy') }}</button>
            @if (!canShareNatively()) {
              <p class="text-xs text-muted" data-qa="share-insecure-note">{{ t('share.noNative') }}</p>
            }
            @if (manualText() !== null) {
              <div>
                <label class="label" for="share-manual">{{ t('share.manual') }}</label>
                <textarea id="share-manual" class="textarea" rows="6" readonly dir="auto" [value]="manualText()" (focus)="$any($event.target).select()" data-qa="share-manual"></textarea>
              </div>
            }
          </div>
        </app-bottom-sheet>
      }
      @case ('new-shop') {
        <app-bottom-sheet [title]="t('groc.newShopTitle')" (closed)="sheet.set(null)">
          <div class="space-y-4 pb-2">
            <p class="text-muted">{{ t('groc.newShopText') }}</p>
            <div class="flex flex-wrap gap-2">
              @for (p of presets(); track p.label) {
                <button type="button" class="chip" [class.chip-active]="rangeStart === p.start && rangeEnd === p.end" (click)="rangeStart = p.start; rangeEnd = p.end">{{ p.label }}</button>
              }
            </div>
            <button type="button" class="btn-primary w-full" (click)="newShop()" [disabled]="!rangeStart || !rangeEnd">{{ t('groc.startShop', { from: label(rangeStart), to: label(rangeEnd) }) }}</button>
          </div>
        </app-bottom-sheet>
      }
    }
  `,
})
export class GroceriesComponent implements OnInit, OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly g = inject(GroceriesService);
  readonly household = inject(HouseholdService);
  private toast = inject(ToastService);

  readonly sheet = signal<Sheet>(null);
  extraName = '';
  rangeStart = '';
  rangeEnd = '';

  readonly range = computed(() => {
    const trip = this.g.list()?.trip;
    return trip ? `${this.i18n.day(trip.start)} - ${this.i18n.day(trip.end)}` : '';
  });
  readonly allDone = computed(() => {
    const p = this.g.progress();
    return p.total > 0 && p.done === p.total;
  });
  readonly presets = computed(() => {
    const today = todayIso();
    const monday = startOfWeek(today);
    return [
      { label: this.t('groc.preset.rest'), start: today, end: addDays(monday, 6) },
      { label: this.t('groc.preset.next7'), start: today, end: addDays(today, 6) },
      { label: this.t('groc.preset.next3'), start: today, end: addDays(today, 2) },
      { label: this.t('groc.preset.nextWeek'), start: addDays(monday, 7), end: addDays(monday, 13) },
    ];
  });

  private onHidden = () => {
    if (document.visibilityState === 'hidden') this.g.markSeen();
  };

  ngOnInit(): void {
    this.g.load();
    document.addEventListener('visibilitychange', this.onHidden);
  }

  ngOnDestroy(): void {
    // "New" dots stay visible while you look; leaving the list marks it seen.
    this.g.markSeen();
    document.removeEventListener('visibilitychange', this.onHidden);
  }

  aisleIcon(aisle: Aisle): string {
    return AISLE_ICONS[aisle];
  }

  label(iso: string): string {
    return iso ? this.i18n.day(iso) : '';
  }

  /** What was already bought of a no-longer-needed item, in the active language. */
  purchased(item: GroceryItem): string {
    return item.purchasedAmounts ? item.purchasedAmounts.map(a => this.i18n.amountParts(a)).join(' + ') : item.purchasedLabel ?? '';
  }

  amountOf(item: GroceryItem): string {
    return itemAmountLabel(item, 'needed', this.i18n);
  }

  optionalAmount(o: Parameters<GroceriesService['addOptionalExtra']>[0]): string {
    return o.amountParts !== undefined ? this.i18n.amountParts(o.amountParts) : o.amount;
  }

  toggle(item: GroceryItem): void {
    if (navigator.vibrate) navigator.vibrate(12);
    this.g.toggle(item).subscribe({ error: () => this.toast.show(this.t('groc.err.update'), 'error') });
  }

  setHave(part: GroceryPart, change: HaveChange): void {
    this.g.setHave(part.key, change.quantity, change.unit).subscribe({ error: () => this.toast.show(this.t('have.err'), 'error') });
  }

  clearAtHome(entry: AtHomeEntry): void {
    this.g.setHave(entry.key, null).subscribe({ error: () => this.toast.show(this.t('have.err'), 'error') });
  }

  /** "I need it" on a staple, with a transient Undo. */
  stapleNeed(item: GroceryItem): void {
    const name = this.i18n.ingredientName(item);
    this.g.setStaplePromoted(item.key, true).subscribe({
      next: () => this.toast.show(this.t('pantry.needToast', { name }), 'success', 6000, {
        label: this.t('common.undo'),
        run: () => this.g.setStaplePromoted(item.key, false).subscribe({ error: () => this.toast.show(this.t('groc.err.update'), 'error') }),
      }),
      error: () => this.toast.show(this.t('groc.err.update'), 'error'),
    });
  }

  /** "I have it": put a staple back in the pantry (works any time), with Undo. */
  stapleHave(item: GroceryItem): void {
    const name = this.i18n.ingredientName(item);
    this.g.setStaplePromoted(item.key, false).subscribe({
      next: () => this.toast.show(this.t('pantry.haveToast', { name }), 'success', 6000, {
        label: this.t('common.undo'),
        run: () => this.g.setStaplePromoted(item.key, true).subscribe({ error: () => this.toast.show(this.t('groc.err.update'), 'error') }),
      }),
      error: () => this.toast.show(this.t('groc.err.update'), 'error'),
    });
  }

  /** "Add to staples": the item stays on this shop's list (marked as a staple); Undo removes it. */
  addToStaples(item: GroceryItem): void {
    const name = this.i18n.ingredientName(item);
    this.g.setHouseholdStaple(item.key, true).subscribe({
      next: () => this.toast.show(this.t('staple.addedToast', { name }), 'success', 6000, {
        label: this.t('common.undo'),
        run: () => this.g.setHouseholdStaple(item.key, false).subscribe({ error: () => this.toast.show(this.t('groc.err.update'), 'error') }),
      }),
      error: () => this.toast.show(this.t('groc.err.update'), 'error'),
    });
  }

  /** "Remove from staples", with Undo that restores the staple and whether it was on the list. */
  removeFromStaples(item: GroceryItem): void {
    const name = this.i18n.ingredientName(item);
    const wasOnList = item.pantryState === 'need';
    this.g.setHouseholdStaple(item.key, false).subscribe({
      next: () => this.toast.show(this.t('staple.removedToast', { name }), 'success', 6000, {
        label: this.t('common.undo'),
        run: () => this.g.setHouseholdStaple(item.key, true, wasOnList).subscribe({ error: () => this.toast.show(this.t('groc.err.update'), 'error') }),
      }),
      error: () => this.toast.show(this.t('groc.err.update'), 'error'),
    });
  }

  addExtra(): void {
    const name = this.extraName.trim();
    if (!name) return;
    this.extraName = '';
    this.g.addExtra(name).subscribe({ error: () => this.toast.show(this.t('groc.err.add'), 'error') });
  }

  addOptional(o: Parameters<GroceriesService['addOptionalExtra']>[0]): void {
    this.g.addOptionalExtra(o).subscribe(() => this.toast.show(this.t('groc.added', { name: this.i18n.ingredientName(o) })));
  }

  openRange(): void {
    const trip = this.g.list()?.trip;
    this.rangeStart = trip?.start ?? todayIso();
    this.rangeEnd = trip?.end ?? addDays(todayIso(), 6);
    this.sheet.set('range');
  }

  openNewShop(): void {
    const preset = this.presets()[0];
    this.rangeStart = preset.start;
    this.rangeEnd = preset.end;
    this.sheet.set('new-shop');
  }

  applyRange(): void {
    this.sheet.set(null);
    this.g.setRange(this.rangeStart, this.rangeEnd).subscribe({ error: () => this.toast.show(this.t('groc.err.dates'), 'error') });
  }

  newShop(): void {
    this.sheet.set(null);
    this.g.startNewShop(this.rangeStart, this.rangeEnd).subscribe(() => this.toast.show(this.t('groc.newShopStarted')));
  }

  // ---- share / export ----------------------------------------------------------------------

  readonly includeChecked = signal(true);
  readonly pdfBusy = signal(false);
  readonly pdfFile = signal<File | null>(null);
  readonly manualText = signal<string | null>(null);
  private pdfJob = 0;
  private pdfReady: Promise<File> | null = null;

  /** Web Share with files needs a secure context (https/localhost); false over http on the LAN. */
  canShareNatively(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  }

  private pdfModel(): GroceryPdfModel {
    return buildGroceryPdfModel({
      trip: this.g.list()?.trip ?? null,
      groups: this.g.aisleGroups(),
      pantryHave: this.g.pantry().filter(i => i.pantryState === 'have'),
      optionalExtras: this.g.optionalExtras(),
      householdName: this.household.household()?.name ?? '',
      includeChecked: this.includeChecked(),
      today: todayIso(),
    }, this.i18n);
  }

  openShare(): void {
    this.manualText.set(null);
    this.sheet.set('share');
    this.preparePdf();
  }

  closeShare(): void {
    this.sheet.set(null);
    this.pdfJob++;
    this.pdfFile.set(null);
    this.pdfReady = null;
  }

  setIncludeChecked(value: boolean): void {
    this.includeChecked.set(value);
    this.preparePdf();
  }

  /** Renders the PDF as soon as the sheet opens (or the option changes) so that "Share" can call
   *  navigator.share() straight from the tap - iOS Safari refuses once the gesture has expired. */
  private preparePdf(): Promise<File> {
    const job = ++this.pdfJob;
    const model = this.pdfModel();
    const name = `mise-shopping-list-${this.g.list()?.trip.start ?? todayIso()}.pdf`;
    this.pdfFile.set(null);
    this.pdfBusy.set(true);
    const ready = import('../../utils/grocery-pdf')
      .then(m => m.renderGroceryPdf(model))
      .then(blob => new File([blob], name, { type: 'application/pdf' }));
    this.pdfReady = ready;
    ready.then(
      file => {
        if (job !== this.pdfJob) return;
        this.pdfFile.set(file);
        this.pdfBusy.set(false);
      },
      () => {
        if (job !== this.pdfJob) return;
        this.pdfBusy.set(false);
        this.toast.show(this.t('share.err.pdf'), 'error', 6000);
      },
    );
    return ready;
  }

  private async currentPdf(): Promise<File | null> {
    try {
      return this.pdfFile() ?? (await (this.pdfReady ?? this.preparePdf()));
    } catch {
      return null;
    }
  }

  async sharePdf(): Promise<void> {
    const ready = this.pdfFile();
    // Called synchronously from the tap when the PDF is ready (the common case).
    const outcome = ready ? await shareFile(ready, this.t('groc.shareTitle')) : 'pending';
    if (outcome === 'shared') return void this.toast.show(this.t('share.shared'));
    if (outcome === 'cancelled') return;
    const file = ready ?? (await this.currentPdf());
    if (!file) return;
    if (!ready) {
      // The gesture may have expired while rendering: try anyway, fall back to saving the file.
      const late = await shareFile(file, this.t('groc.shareTitle'));
      if (late === 'shared') return void this.toast.show(this.t('share.shared'));
      if (late === 'cancelled') return;
    }
    this.save(file);
  }

  async downloadPdf(): Promise<void> {
    const file = await this.currentPdf();
    if (file) this.save(file);
  }

  private save(file: File): void {
    if (downloadBlob(file, file.name)) this.toast.show(this.t('share.downloaded'), 'success', 5000);
    else if (openBlob(file)) this.toast.show(this.t('share.opened'), 'info', 5000);
    else this.toast.show(this.t('share.err.save'), 'error', 6000);
  }

  async copyAsText(): Promise<void> {
    const text = this.shareText();
    if (await copyText(text)) {
      this.manualText.set(null);
      this.toast.show(this.t('groc.copied'));
    } else {
      // Last resort: show the text selected so it can be copied by hand.
      this.manualText.set(text);
      this.toast.show(this.t('share.err.copy'), 'error', 6000);
      setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-qa=share-manual]')?.select(), 50);
    }
  }

  /** Plain text of the same model as the PDF (localized names, units, aisles; remaining amounts). */
  shareText(): string {
    return groceryPdfModelToText(this.pdfModel());
  }
}
