import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { GroceryPart } from '../../models';
import { clampQuantity, editorUnit, familyUnits, formatQuantity, fromBase, parseQuantity, stepFor, toBase } from '../../utils/grocery-have';
import { IconComponent } from '../icon/icon.component';

export interface HaveChange {
  /** Amount in `unit`; null clears what is at home. */
  quantity: number | null;
  unit: string | null;
}

const COMMIT_DELAY_MS = 450;

/** "At home: [-] 3 [+] pieces" for one part of a grocery line. Stepper and typed number, unit
 *  picker inside the part's unit family. Commits after a short pause (or on blur / Enter), so
 *  tapping + three times sends one request. */
@Component({
  selector: 'app-have-editor',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2" data-qa="have-editor">
      <span class="text-sm text-muted">{{ t('have.atHome') }}</span>
      <div class="inline-flex items-center rounded-full border border-hairline bg-surface" data-qa="have-stepper" dir="ltr">
        <button type="button" class="btn-icon h-11 w-11" (click)="step(-1)" [disabled]="current() <= 0"
                [attr.aria-label]="t('have.less', { name: name() })" data-qa="have-minus"><app-icon name="minus" [size]="18" /></button>
        <input class="h-11 w-16 bg-transparent text-center tabular-nums outline-none" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
               [value]="text()" [attr.aria-invalid]="invalid()" [attr.aria-label]="t('have.input', { name: name() })" data-qa="have-input"
               (input)="onInput($any($event.target).value)" (blur)="commit()" (keydown.enter)="commit()" />
        <button type="button" class="btn-icon h-11 w-11" (click)="step(1)"
                [attr.aria-label]="t('have.more', { name: name() })" data-qa="have-plus"><app-icon name="plus" [size]="18" /></button>
      </div>
      @if (units().length > 1) {
        <select class="select h-11 w-auto min-w-[5rem]" [value]="unit()" (change)="setUnit($any($event.target).value)"
                [attr.aria-label]="t('have.unit')" data-qa="have-unit">
          @for (u of units(); track u) { <option [value]="u" [selected]="u === unit()">{{ unitLabel(u) }}</option> }
        </select>
      } @else if (countLabel()) {
        <span class="text-sm text-muted">{{ countLabel() }}</span>
      }
      @if (part().have) {
        <button type="button" class="btn-ghost min-h-[44px] px-3" (click)="clear()" data-qa="have-clear">{{ t('have.clear') }}</button>
      }
    </div>
    @if (invalid()) { <p class="mt-1 text-xs text-accent" role="alert">{{ t('have.invalid') }}</p> }
  `,
})
export class HaveEditorComponent implements OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  readonly part = input.required<GroceryPart>();
  /** Localized ingredient name, for the aria-labels. */
  readonly name = input('');
  readonly changed = output<HaveChange>();

  protected readonly unit = signal<string | null>(null);
  protected readonly text = signal('');
  protected readonly invalid = signal(false);
  protected readonly units = computed(() => familyUnits(this.part().family));
  protected readonly current = computed(() => parseQuantity(this.text()) ?? 0);
  protected readonly countLabel = computed(() => {
    const family = this.part().family;
    if (!family.startsWith('count:')) return '';
    const code = family.split(':')[1];
    return code === 'piece' ? '' : this.i18n.unit(code, this.current() > 1 ? 2 : 1);
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const part = this.part();
      untracked(() => {
        if (this.timer) return; // the user is mid-edit: keep what they typed
        if (!this.unit()) this.unit.set(editorUnit(part));
        this.text.set(part.have && part.have > 0 ? this.i18n.digits(formatQuantity(fromBase(part.have, this.unit()))) : '');
        this.invalid.set(false);
      });
    });
  }

  ngOnDestroy(): void {
    if (this.timer) this.commit();
  }

  protected unitLabel(unit: string): string {
    return this.i18n.unit(unit, 1);
  }

  protected onInput(value: string): void {
    this.text.set(value);
    this.invalid.set(value.trim() !== '' && parseQuantity(value) === null);
    this.schedule();
  }

  protected step(direction: 1 | -1): void {
    const next = clampQuantity(this.current() + direction * stepFor(this.unit()));
    this.text.set(next > 0 ? this.i18n.digits(formatQuantity(next)) : '');
    this.invalid.set(false);
    this.schedule();
  }

  protected setUnit(unit: string): void {
    const base = toBase(this.current(), this.unit());
    this.unit.set(unit);
    this.text.set(base > 0 ? this.i18n.digits(formatQuantity(fromBase(base, unit))) : '');
    this.invalid.set(false);
    if (this.timer) this.schedule(); // a pending edit keeps its value in the new unit
  }

  protected clear(): void {
    this.text.set('');
    this.invalid.set(false);
    this.cancel();
    this.changed.emit({ quantity: null, unit: this.unit() });
  }

  private schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => this.commit(), COMMIT_DELAY_MS);
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  protected commit(_final = true): void {
    this.cancel();
    const typed = this.text().trim();
    const value = typed === '' ? 0 : parseQuantity(typed);
    const part = this.part();
    const saved = part.have && part.have > 0 ? clampQuantity(fromBase(part.have, this.unit())) : 0;
    if (value === null) {
      // Not a number: go back to what is saved.
      this.invalid.set(false);
      this.text.set(saved > 0 ? this.i18n.digits(formatQuantity(saved)) : '');
      return;
    }
    if (Math.abs(value - saved) < 1e-9) return;
    this.changed.emit({ quantity: value > 0 ? value : null, unit: this.unit() });
  }
}
