import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { GroceryItem, GroceryPart } from '../../models';
import { fromBase, isQuantified } from '../../utils/grocery-have';
import { HaveChange, HaveEditorComponent } from '../have-editor/have-editor.component';
import { IconComponent } from '../icon/icon.component';

export interface GroceryItemView {
  checked: boolean;
  /** Main amount text: what's left to buy (or the full need). */
  amount: string;
  /** "+4 more" when the plan grew after something was bought. */
  morePill: string | null;
  /** "Got 6" note when something was already bought. */
  boughtNote: string | null;
  dimmed: boolean;
  /** Fully covered by what is at home (nothing to buy). */
  covered: boolean;
  /** "need 3 more" when part of the need is covered by what is at home. */
  needMore: string | null;
  /** "3 at home" (the saved have-amounts). */
  atHomeNote: string | null;
}

const EPSILON = 1e-6;

function partDone(p: GroceryPart): boolean {
  return (p.remaining !== null && p.remaining <= EPSILON) || (p.remaining === null && p.checked);
}

/** The item's amount in the active language, built from the parts' structured amounts
 *  (`neededAmount` / `remainingAmount`); falls back to the server's English label for lists
 *  cached by an older version of the app. */
export function itemAmountLabel(item: GroceryItem, kind: 'needed' | 'remaining', i18n: I18nService, withEquivalent = false): string {
  const parts = kind === 'needed' ? item.parts : item.parts.filter(p => !partDone(p));
  const amounts = parts.map(p => (kind === 'needed' ? p.neededAmount : p.remainingAmount));
  if (parts.length && amounts.some(a => a === undefined)) return kind === 'needed' ? item.neededLabel : item.remainingLabel;
  return parts.map((p, i) => {
    const text = i18n.amountParts(amounts[i]);
    const eq = withEquivalent && text ? partEquivalent(item, p, kind, i18n) : '';
    return eq ? `${text} ${eq}` : text;
  }).filter(Boolean).join(' + ');
}

/** "(30 ml)" / "(≈ 120 g)" for a part shown in a kitchen unit (display only: the amount is the
 *  base quantity converted back to the unit the server showed it in). */
export function partEquivalent(item: GroceryItem, p: GroceryPart, kind: 'needed' | 'remaining', i18n: I18nService): string {
  const a = kind === 'needed' ? p.neededAmount : p.remainingAmount;
  const base = kind === 'needed' ? p.needed : p.remaining;
  if (!a?.unit || base === null || base === undefined) return '';
  return i18n.equivalent(fromBase(base, a.unit), a.unit, item.key);
}

/** How a grocery item renders, from its server state (pure, unit-tested). Pass the I18nService
 *  to get localized amounts and phrases; without it the server's English labels are used. */
export function groceryItemView(item: GroceryItem, i18n?: I18nService): GroceryItemView {
  const covered = item.state === 'covered';
  const checked = item.state === 'in_cart' || covered;
  const boughtParts = item.parts.filter(p => p.checked && p.purchased !== null && p.purchased > 0);
  const needed = i18n ? itemAmountLabel(item, 'needed', i18n) : item.neededLabel;
  const remaining = i18n ? itemAmountLabel(item, 'remaining', i18n) : item.remainingLabel;
  const haveParts = item.parts.filter(p => (p.have ?? 0) > 0);
  const haveText = i18n
    ? haveParts.map(p => i18n.amountParts(p.haveAmount)).filter(Boolean).join(' + ')
    : '';
  const partial = !!item.hasHave && item.state === 'to_buy' && !item.moreNeeded && !!remaining;
  // Plural-aware "need N more": the count is the remaining amount of a single counted part.
  const count = item.parts.length === 1 && item.parts[0].remaining ? Math.ceil(item.parts[0].remaining - 0.05) : 2;
  return {
    checked,
    amount: item.moreNeeded ? remaining : needed,
    morePill: item.moreNeeded && remaining
      ? (i18n ? i18n.t('grocery.moreNeeded', { amount: remaining }) : `+${remaining} more`)
      : null,
    boughtNote: item.moreNeeded && boughtParts.length ? (i18n ? i18n.t('grocery.boughtNote') : 'Some already bought - the plan grew since') : null,
    dimmed: checked,
    covered,
    needMore: partial ? (i18n ? i18n.t('grocery.needMore', { amount: remaining, count }) : `need ${remaining} more`) : null,
    atHomeNote: haveText && i18n ? i18n.t('grocery.atHomeNote', { amount: haveText }) : null,
  };
}

/** One grocery line: big tap target checkbox, name + amount, "+N more" / new dot, and a tap
 *  on the text expands where it comes from ("Tue 21 dinner - Shakshuka (3)"). */
@Component({
  selector: 'app-grocery-item',
  standalone: true,
  imports: [IconComponent, HaveEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-start gap-1 px-2 py-1.5" [class.opacity-55]="view().dimmed">
      <button type="button" role="checkbox" [attr.aria-checked]="view().checked" [disabled]="busy()"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              (click)="onCheck()" [attr.aria-label]="checkLabel()">
        <span class="flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-200"
              [class.border-primary]="view().checked" [class.bg-primary]="view().checked" [class.text-primary-on]="view().checked"
              [class.border-hairline]="!view().checked" [class.scale-95]="busy()">
          @if (view().checked) { <app-icon name="check" [size]="16" /> }
        </span>
      </button>
      <button type="button" class="min-w-0 flex-1 py-2 text-start" (click)="expanded.set(!expanded())"
              [attr.aria-expanded]="expanded()" data-qa="grocery-item-toggle">
        <span class="flex items-baseline gap-2">
          <span class="truncate font-medium first-letter:uppercase" [class.line-through]="view().checked" dir="auto">{{ name() }}</span>
          @if (item().isNew && !view().checked) { <span class="new-dot shrink-0 self-center" [attr.aria-label]="t('grocery.new')"></span> }
          <span class="ms-auto shrink-0 text-sm tabular-nums text-muted" dir="auto">{{ view().amount }}</span>
          <app-icon name="chevron-down" [size]="14" class="shrink-0 self-center text-muted transition-transform motion-reduce:transition-none" [class.rotate-180]="expanded()" />
        </span>
        @if (item().pantryState) {
          <span class="mt-1 me-1 inline-flex rounded-full bg-primary-tint px-2 py-0.5 text-xs font-semibold text-primary" data-qa="staple-badge">{{ t('staple.badge') }}</span>
        }
        @if (view().morePill) {
          <span class="mt-1 inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">{{ view().morePill }}</span>
        }
        @if (view().needMore) {
          <span class="mt-1 inline-flex rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent" data-qa="need-more">{{ view().needMore }}</span>
        }
        @if (view().atHomeNote) {
          <span class="mt-1 block text-xs text-muted" data-qa="at-home-note">{{ view().atHomeNote }}</span>
        } @else if (view().covered) {
          <span class="mt-1 block text-xs text-muted">{{ t('grocery.covered') }}</span>
        }
        @if (expanded()) {
          <span class="mt-2 block space-y-1 text-sm text-muted animate-fade-in">
            @for (s of item().sources; track $index) {
              <span class="block">{{ t('grocery.sourceLine', { day: day(s.date), slot: slot(s.slot), recipe: s.recipeName }) }}@if (amountOf(s); as amt) { ({{ amt }})}</span>
            } @empty {
              <span class="block">{{ t('grocery.notInPlan') }}</span>
            }
            @if (view().boughtNote) { <span class="block italic">{{ view().boughtNote }}</span> }
            @if (equivalentText(); as eq) { <span class="block" dir="auto" data-qa="unit-equivalent"><bdi>{{ eq }}</bdi></span> }
          </span>
        }
      </button>
      @if (item().pantryState === 'need') {
        <button type="button" class="btn-ghost mt-1 min-h-[44px] shrink-0 px-3" (click)="stapleHave.emit(item())" data-qa="staple-have">{{ t('pantry.iHaveIt') }}</button>
      }
    </div>
    @if (expanded()) {
      <div class="px-3 pb-2 ps-11 animate-fade-in">
        @if (item().pantryState) {
          <button type="button" class="btn-ghost min-h-[44px] px-3 text-sm text-muted" (click)="stapleRemove.emit(item())" data-qa="remove-staple">
            <app-icon name="x" [size]="16" /> {{ t('staple.remove') }}
          </button>
        } @else {
          <button type="button" class="btn-ghost min-h-[44px] px-3 text-sm" (click)="stapleAdd.emit(item())" data-qa="add-staple">
            <app-icon name="plus" [size]="16" /> {{ t('staple.add') }}
          </button>
        }
      </div>
    }
    @if (expanded() && editableParts().length) {
      <div class="space-y-3 px-3 pb-3 ps-14 animate-fade-in" data-qa="have-panel">
        @for (p of editableParts(); track p.key) {
          <div>
            @if (item().parts.length > 1) { <p class="mb-1 text-xs text-muted">{{ amountOfPart(p) }}</p> }
            <app-have-editor [part]="p" [name]="name()" (changed)="haveChanged.emit({ part: p, change: $event })" />
          </div>
        }
      </div>
    }
  `,
})
export class GroceryItemComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;
  readonly item = input.required<GroceryItem>();
  readonly busy = input(false);
  readonly toggled = output<GroceryItem>();
  /** "I have N at home" edited for one part. */
  readonly haveChanged = output<{ part: GroceryPart; change: HaveChange }>();
  /** A promoted staple put back in the pantry. */
  readonly stapleHave = output<GroceryItem>();
  /** "Add to staples" / "Remove from staples" requested for this item. */
  readonly stapleAdd = output<GroceryItem>();
  readonly stapleRemove = output<GroceryItem>();

  readonly expanded = signal(false);
  readonly view = computed(() => groceryItemView(this.item(), this.i18n));
  /** Localized name; `key` (the canonical English name) stays the identity for mark/unmark. */
  readonly name = computed(() => this.i18n.ingredientName(this.item()));

  /** Parts that can hold an at-home amount (quantified; staples are handled by the pantry). */
  readonly editableParts = computed(() => (this.item().staple ? [] : this.item().parts.filter(isQuantified)));

  /** Expanded row only: the needed amount with its metric equivalent, when there is one. */
  readonly equivalentText = computed(() => {
    const it = this.item();
    return it.parts.some(p => partEquivalent(it, p, 'needed', this.i18n)) ? itemAmountLabel(it, 'needed', this.i18n, true) : '';
  });

  checkLabel(): string {
    return this.view().covered ? this.t('grocery.editHave', { name: this.name() }) : this.t(this.view().checked ? 'grocery.uncheck' : 'grocery.check', { name: this.name() });
  }

  /** A covered line has nothing to check off: its checkbox opens the at-home editor instead. */
  onCheck(): void {
    if (this.view().covered) this.expanded.set(true);
    else this.toggled.emit(this.item());
  }

  amountOfPart(p: GroceryPart): string {
    return this.i18n.amountParts(p.neededAmount);
  }

  amountOf(s: GroceryItem['sources'][number]): string {
    return s.amountParts !== undefined ? this.i18n.amountParts(s.amountParts) : s.amount;
  }

  day(date: string): string {
    return this.i18n.day(date);
  }

  slot(slot: string): string {
    return this.i18n.slotLower(slot);
  }
}
