import { equivalentName } from '../../utils/unit-equivalent';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, input, model, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { I18nService } from '../../i18n/i18n.service';
import { normalizeSearch } from '../../i18n/search';
import { UnitCode, suggestUnits, unitCode } from '../../i18n/units';
import { Aisle, IngredientCheck, IngredientSuggestion } from '../../models';
import { StorageService } from '../../services/storage.service';
import {
  DraftContext, LineInfo, TextEdit, applyEdits, autoTranslation, draftContext, lineAt, nameReplacement, splitLines, unitReplacement,
} from '../../utils/ingredient-draft';
import { formatQuantity, parseIngredientLine, parseIngredientText } from '../../utils/ingredient-parser';

/** One row of the suggestion list: a unit completion or an ingredient name. */
export interface SuggestionRow {
  id: string;
  kind: 'unit' | 'name';
  /** What is inserted (reader-language form). */
  label: string;
  /** The alias the user typed against, shown subtly when it differs from `label`. */
  matched: string | null;
  tag: string | null;
  item?: IngredientSuggestion;
  code?: UnitCode;
}

/** A rewrite the field made on its own (kept so it can be shown as "was: ..." and undone). */
export interface Replacement {
  kind: 'name' | 'unit';
  from: string;
  to: string;
  lineBefore: string;
  lineAfter: string;
}

interface NameQuery { query: string; lang: string; epoch: number }

const MAX_NAME_ROWS = 6;
const MAX_UNIT_ROWS = 3;
const SUGGEST_DEBOUNCE_MS = 150;

/**
 * The recipe form's ingredient textarea with a real helper: while typing a line it suggests
 * units (after the quantity) and ingredient names (English, French and Arabic, shown in the
 * reader's language; debounced `GET /api/recipes/ingredient-suggest`, stale requests cancelled)
 * in an ARIA combobox/listbox anchored under the caret line (Up/Down/Enter/Escape, 44 px rows).
 * Recognized units and names are rewritten into the reader's language when the line is
 * finished (Enter, blur, paste) or a suggestion is accepted, but only for exact dictionary
 * matches (never typos); a rewrite stays visible as "was: ..." with an Undo, and undoing or
 * retyping the original is respected. Below the field a live preview shows how every line
 * was read ("2 tbsp · butter · Dairy & eggs"), flagging names the dictionary does not know.
 */
@Component({
  selector: 'app-ingredient-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <textarea #ta [id]="inputId()" name="ingredients" dir="auto" class="textarea min-h-[180px]" data-qa="ingredient-input"
                [placeholder]="i18n.t('edit.ingPlaceholder')" [value]="text()"
                role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
                [attr.aria-expanded]="open()" [attr.aria-controls]="listId" [attr.aria-activedescendant]="activeId()"
                (input)="onInput($event)" (keydown)="onKeydown($event)" (keyup)="onKeyup($event)" (click)="refresh()"
                (focus)="focused.set(true)" (blur)="onBlur()" (paste)="onPaste()" (scroll)="refresh()"></textarea>
      @if (open()) {
        <ul [id]="listId" role="listbox" data-qa="ingredient-suggest" [attr.aria-label]="i18n.t('ing.suggestions')"
            class="absolute inset-x-0 z-20 max-h-[300px] animate-fade-in overflow-y-auto overscroll-contain rounded-2xl border border-hairline bg-surface p-1 shadow-soft"
            [style.top.px]="anchorTop()" (mousedown)="$event.preventDefault()">
          @for (row of rows(); track row.id; let i = $index) {
            <li [id]="row.id" role="option" [attr.aria-selected]="i === active()" [attr.data-qa]="row.kind === 'unit' ? 'unit-suggest' : 'ingredient-suggestion'"
                class="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-start"
                [class.bg-primary-tint]="i === active()" (click)="accept(row)">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-ink"><bdi>{{ row.label }}</bdi></span>
                @if (row.matched) { <span class="block truncate text-xs text-muted"><bdi>{{ row.matched }}</bdi></span> }
              </span>
              @if (row.tag) { <span class="chip-quiet shrink-0">{{ row.tag }}</span> }
            </li>
          }
        </ul>
      }
      <p class="sr-only" role="status" aria-live="polite">{{ open() ? i18n.t('ing.announce', { count: rows().length }) : '' }}</p>
    </div>

    @if (parsed().length) {
      <ul class="mt-2 space-y-1" data-qa="ingredient-preview" [attr.aria-label]="i18n.t('edit.parsedLabel')">
        @for (p of parsed(); track $index) {
          <li class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-xl bg-sunken px-3 py-1.5 text-sm">
            @if (p.quantity !== null || p.unit) {
              <span class="whitespace-nowrap">
                @if (p.quantity !== null) { <b class="text-ink">{{ qty(p.quantity, p.quantityMin) }}</b>{{ ' ' }} }
                @if (p.unit) { <span class="text-primary">{{ i18n.unit(p.unit, p.quantity) }}</span> }
                @if (equivOf(p); as eq) { <bdi class="ms-1 text-muted" data-qa="unit-equivalent">{{ eq }}</bdi> }
              </span>
              <span class="text-muted" aria-hidden="true">·</span>
            }
            <span class="font-medium text-ink" dir="auto">{{ p.name }}</span>
            @if (aisleOf(p.name); as a) {
              <span class="text-muted" aria-hidden="true">·</span>
              <span class="text-muted">{{ a }}</span>
            } @else if (isUnknown(p.name)) {
              <button type="button" class="chip min-h-[44px] border-accent/50 text-accent" data-qa="ingredient-unknown" (click)="aisleRequested.emit(canonicalOf(p.name))">
                {{ i18n.t('ing.unknown') }} · {{ i18n.t('ing.pickAisle') }}
              </button>
            }
            @if (shownAs(p.name); as s) { <span class="text-muted" dir="auto">({{ i18n.t('edit.shownAs', { name: s }) }})</span> }
            @if (p.note) { <i class="text-muted" dir="auto">{{ p.note }}</i> }
            @if (p.optional) { <span class="text-muted">{{ i18n.t('edit.optionalParen') }}</span> }
            @for (r of replacementsFor(p); track r.to + r.kind) {
              <button type="button" class="chip-quiet -my-1 min-h-[44px] gap-1.5 px-3" data-qa="ingredient-was" [attr.aria-label]="i18n.t('ing.undoLabel', { name: r.from })" (click)="undo(r)">
                <span dir="auto">{{ i18n.t('ing.was', { name: r.from }) }}</span>
                <span class="font-semibold text-primary">{{ i18n.t('ing.undo') }}</span>
              </button>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class IngredientFieldComponent {
  protected readonly i18n = inject(I18nService);
  private storage = inject(StorageService);
  private injector = inject(Injector);

  /** The ingredients text (two-way). */
  readonly text = model('');
  readonly inputId = input('r-ingredients');
  /** Server answers per typed name (owned by the form, which asks for them debounced). */
  readonly checks = input<Record<string, IngredientCheck>>({});
  /** The user's aisle picks, by canonical name. */
  readonly picks = input<Record<string, Aisle>>({});
  /** The user tapped "Not in our list" on a line: the form scrolls to its aisle picker. */
  readonly aisleRequested = output<string>();

  private readonly ta = viewChild.required<ElementRef<HTMLTextAreaElement>>('ta');
  protected readonly listId = `ing-suggest-${Math.random().toString(36).slice(2, 8)}`;

  protected readonly focused = signal(false);
  protected readonly dismissed = signal(false);
  protected readonly active = signal(-1);
  protected readonly anchorTop = signal(0);
  private readonly unitRows = signal<SuggestionRow[]>([]);
  private readonly nameItems = signal<IngredientSuggestion[]>([]);
  /** Rewrites made on the user's behalf, newest last. */
  readonly replaced = signal<Replacement[]>([]);

  private readonly queries = new Subject<NameQuery>();
  /** Bumped when a suggestion is taken, so typing the same word again asks again. */
  private epoch = 0;
  private ctx: { line: LineInfo; caret: number; prefix: string; draft: DraftContext } | null = null;
  /** Originals the user took back (or retyped): never rewritten again. */
  private readonly declined = new Set<string>();
  /** Originals we already rewrote once (so retyping one counts as "leave it"). */
  private readonly originals = new Set<string>();
  private applying = false;

  protected readonly parsed = computed(() => parseIngredientText(this.text()));

  protected readonly rows = computed<SuggestionRow[]>(() => {
    const units = this.unitRows();
    const names: SuggestionRow[] = this.nameItems()
      .slice(0, MAX_NAME_ROWS - units.length)
      .map((item, i) => ({
        id: `${this.listId}-n${i}`,
        kind: 'name' as const,
        label: item.name,
        matched: item.matched,
        tag: item.custom ? this.i18n.t('ing.customTag') : null,
        item,
      }));
    return [...units, ...names];
  });
  protected readonly open = computed(() => this.focused() && !this.dismissed() && this.rows().length > 0);
  protected readonly activeId = computed(() => (this.open() && this.active() >= 0 ? this.rows()[this.active()]?.id ?? null : null));

  constructor() {
    this.queries.pipe(
      debounceTime(SUGGEST_DEBOUNCE_MS),
      distinctUntilChanged((a, b) => a.query === b.query && a.lang === b.lang && a.epoch === b.epoch),
      switchMap(({ query, lang }) => (query ? this.storage.suggestIngredients(query, lang, MAX_NAME_ROWS) : of([] as IngredientSuggestion[]))),
      takeUntilDestroyed(),
    ).subscribe(items => {
      this.nameItems.set(items);
      this.active.set(-1);
    });
  }

  // ---- preview ----

  protected qty(q: number, min?: number): string {
    return this.i18n.digits(min !== undefined ? `${formatQuantity(min)}-${formatQuantity(q)}` : formatQuantity(q));
  }

  /** "(30 ml)" / "(≈ 120 g)" next to a parsed amount (only dictionary-known names get weights). */
  protected equivOf(p: { quantity: number | null; unit: string | null; name: string }): string {
    const c = this.check(p.name);
    return this.i18n.equivalent(p.quantity, p.unit, c?.known ? equivalentName({ canonical: c.canonical, name: p.name }) : undefined, true);
  }

  private check(name: string): IngredientCheck | undefined {
    return this.checks()[name.trim()];
  }

  protected canonicalOf(name: string): string {
    return this.check(name)?.canonical ?? name;
  }

  protected isUnknown(name: string): boolean {
    const c = this.check(name);
    return !!c && !c.known;
  }

  /** The aisle shown in the preview: the dictionary's, or the one picked / remembered for an unknown name. */
  protected aisleOf(name: string): string {
    const c = this.check(name);
    if (!c) return '';
    if (c.known) return this.i18n.aisle(c.aisle);
    const picked = this.picks()[c.canonical] ?? (c.remembered ? c.aisle : null);
    return picked ? this.i18n.aisle(picked) : '';
  }

  /** The reader-language name an ingredient typed in another language will be shown as. */
  protected shownAs(typed: string): string {
    const c = this.check(typed);
    if (!c?.known || !c.names) return '';
    const shown = c.names[this.i18n.language()];
    return shown && normalizeSearch(shown) !== normalizeSearch(typed.trim()) ? shown : '';
  }

  protected replacementsFor(p: { name: string; unitTyped?: string }): Replacement[] {
    return this.replaced().filter(r =>
      r.kind === 'name' ? r.to.toLowerCase() === p.name.trim().toLowerCase() : !!p.unitTyped && r.to.toLowerCase() === p.unitTyped.toLowerCase());
  }

  // ---- events ----

  protected onInput(event: Event): void {
    const ta = this.ta().nativeElement;
    this.text.set(ta.value);
    if (this.applying) return;
    this.detectRetype(ta);
    this.dismissed.set(false);
    this.refresh();
    // Enter finished the line above the caret: tidy it.
    if ((event as InputEvent).inputType === 'insertLineBreak') {
      const line = lineAt(ta.value, ta.selectionStart);
      if (line.index > 0) void this.normalize([line.index - 1]);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    if (!this.open()) {
      if (event.key === 'ArrowDown' && this.dismissed() && rows.length && !event.altKey) {
        event.preventDefault();
        this.dismissed.set(false);
        this.active.set(0);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.active.set((this.active() + 1) % rows.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.active.set(this.active() <= 0 ? rows.length - 1 : this.active() - 1);
        break;
      case 'Enter':
        // Only an arrowed-to suggestion is taken; a plain Enter stays a line break.
        if (this.active() >= 0 && !event.isComposing) {
          event.preventDefault();
          this.accept(rows[this.active()]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.set(true);
        this.active.set(-1);
        break;
    }
  }

  protected onKeyup(event: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) || (!this.open() && ['ArrowUp', 'ArrowDown'].includes(event.key))) {
      this.refresh();
    }
  }

  protected onBlur(): void {
    this.focused.set(false);
    this.active.set(-1);
    void this.normalize('all');
  }

  protected onPaste(): void {
    // The pasted text lands after this event: tidy every line once it has.
    setTimeout(() => {
      this.text.set(this.ta().nativeElement.value);
      void this.normalize('all');
    });
  }

  // ---- suggestions ----

  /** Recompute what to suggest for the caret's line. */
  protected refresh(): void {
    const ta = this.ta().nativeElement;
    if (ta.selectionStart !== ta.selectionEnd) {
      this.clearSuggestions();
      return;
    }
    const caret = ta.selectionStart;
    const line = lineAt(ta.value, caret);
    const prefix = line.text.slice(0, caret - line.start);
    const draft = draftContext(prefix);
    this.ctx = { line, caret, prefix, draft };
    const q = draft.unit?.quantity ?? 0;
    const units = draft.unit ? suggestUnits(draft.unit.partial.trimEnd(), MAX_UNIT_ROWS) : [];
    this.unitRows.set(
      units
        .map((u, i) => {
          const label = this.i18n.unitByCode(u.code, q > 1);
          return {
            id: `${this.listId}-u${i}`,
            kind: 'unit' as const,
            label,
            matched: normalizeSearch(u.matched) === normalizeSearch(label) ? null : u.matched,
            tag: this.i18n.t('ing.unitTag'),
            code: u.code,
          };
        })
        .filter(r => normalizeSearch(r.label) !== normalizeSearch(draft.unit?.partial.trim() ?? '')),
    );
    if (!draft.name) this.nameItems.set([]);
    this.queries.next({ query: draft.name?.query ?? '', lang: this.i18n.language(), epoch: this.epoch });
    this.anchorTop.set(this.caretBottom(ta, caret));
    this.active.set(-1);
  }

  private clearSuggestions(): void {
    this.ctx = null;
    this.unitRows.set([]);
    this.nameItems.set([]);
    this.queries.next({ query: '', lang: this.i18n.language(), epoch: this.epoch });
  }

  protected accept(row: SuggestionRow): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const lang = this.i18n.language();
    let edit: TextEdit | null = null;
    if (row.kind === 'unit' && ctx.draft.unit) {
      const next = ctx.line.text[ctx.caret - ctx.line.start];
      const insert = row.label + (next === ' ' ? '' : ' ');
      edit = { from: ctx.line.start + ctx.draft.unit.start, to: ctx.caret, insert };
    } else if (row.kind === 'name' && ctx.draft.name) {
      const local = nameReplacement(ctx.prefix, ctx.draft.name.start, ctx.prefix.length, row.label, lang, ctx.draft.name.hasUnit);
      edit = { from: ctx.line.start + local.from, to: ctx.line.start + local.to, insert: local.insert };
      // A complete word that became its translation can be taken back; a half-typed prefix cannot.
      const typed = ctx.draft.name.query;
      if (row.item?.match === 'exact' && normalizeSearch(typed) !== normalizeSearch(row.label)) {
        const lineAfter = applyEdits(ctx.line.text, [local]);
        this.record({ kind: 'name', from: typed, to: row.label, lineBefore: ctx.line.text, lineAfter });
      }
    }
    if (!edit) return;
    this.commit([edit]);
    this.dismissed.set(true);
    this.unitRows.set([]);
    this.nameItems.set([]);
    this.epoch++;
    this.queries.next({ query: '', lang: this.i18n.language(), epoch: this.epoch });
    this.ta().nativeElement.focus();
  }

  /** Pixel offset (from the textarea's top) of the bottom of the caret's visual line. */
  private caretBottom(ta: HTMLTextAreaElement, caret: number): number {
    try {
      const cs = getComputedStyle(ta);
      const mirror = document.createElement('div');
      for (const prop of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'direction', 'textAlign', 'tabSize'] as const) {
        mirror.style[prop as 'width'] = cs[prop as 'width'];
      }
      Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', insetInlineStart: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
      mirror.textContent = ta.value.slice(0, caret);
      const marker = document.createElement('span');
      marker.textContent = '​';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const bottom = marker.offsetTop + marker.offsetHeight - ta.scrollTop + 4;
      mirror.remove();
      return Math.max(40, Math.min(bottom, ta.clientHeight));
    } catch {
      return ta.clientHeight;
    }
  }

  // ---- rewriting ----

  /** Apply edits to the textarea. While it has focus the browser's own undo stack is kept
   *  (Ctrl+Z walks back the rewrite); otherwise the value is set directly. */
  private commit(edits: TextEdit[]): void {
    const ta = this.ta().nativeElement;
    const sorted = [...edits].sort((a, b) => b.from - a.from);
    const focused = document.activeElement === ta;
    // Keep the caret where the user is typing: edits before it shift it, an edit around it ends at its end.
    const moved = (pos: number): number => {
      let out = pos;
      let delta = 0;
      for (const e of [...edits].sort((a, b) => a.from - b.from)) {
        if (e.to <= out) delta += e.insert.length - (e.to - e.from);
        else if (e.from < out) {
          out = e.to;
          delta += e.insert.length - (e.to - e.from);
        }
      }
      return out + delta;
    };
    const caret: [number, number] = [moved(ta.selectionStart), moved(ta.selectionEnd)];
    this.applying = true;
    try {
      if (focused && typeof document.execCommand === 'function') {
        let ok = true;
        for (const e of sorted) {
          ta.setSelectionRange(e.from, e.to);
          if (!document.execCommand('insertText', false, e.insert)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          this.text.set(ta.value);
          ta.setSelectionRange(...caret);
          return;
        }
      }
      const next = applyEdits(ta.value, edits);
      ta.value = next;
      this.text.set(next);
      if (focused) ta.setSelectionRange(...caret);
    } finally {
      this.applying = false;
    }
  }

  private record(r: Replacement): void {
    this.originals.add(r.from.toLowerCase());
    this.replaced.update(list => [...list.filter(x => !(x.kind === r.kind && x.to === r.to)), r].slice(-30));
  }

  /** If the user typed back something we had rewritten (or Ctrl+Z restored it), keep it. */
  private detectRetype(ta: HTMLTextAreaElement): void {
    if (!this.originals.size) return;
    const line = lineAt(ta.value, ta.selectionStart);
    const parsed = parseIngredientLine(line.text);
    if (parsed?.kind !== 'ingredient') return;
    const name = parsed.ingredient.name.trim().toLowerCase();
    if (this.originals.has(name)) this.declined.add(`n:${name}`);
    const unit = parsed.ingredient.unitTyped?.toLowerCase();
    if (unit && this.originals.has(unit)) this.declined.add(`u:${unit}`);
  }

  /** Rewrite recognized units and exactly-matched names of the given lines (or all) into the
   *  reader's language. Names need the server's answer; it is fetched for names not yet checked. */
  async normalize(which: number[] | 'all'): Promise<void> {
    const snapshot = this.text();
    const lines = splitLines(snapshot);
    const targets = which === 'all' ? lines : which.map(i => lines[i]).filter(Boolean);
    const lang = this.i18n.language();

    interface Plan { line: LineInfo; name: string; hasUnit: boolean; unitEdit: TextEdit | null; unitNote: Replacement | null }
    const plans: Plan[] = [];
    for (const line of targets) {
      const parsed = parseIngredientLine(line.text);
      if (parsed?.kind !== 'ingredient') continue;
      const ing = parsed.ingredient;
      let unitEdit: TextEdit | null = null;
      let unitNote: Replacement | null = null;
      const code = ing.unit ? unitCode(ing.unit) : null;
      if (code && ing.unitTyped && !this.declined.has(`u:${ing.unitTyped.toLowerCase()}`)) {
        const label = this.i18n.unitByCode(code, (ing.quantity ?? 0) > 1);
        unitEdit = unitReplacement(line.text, ing, label);
        if (unitEdit) unitNote = { kind: 'unit', from: ing.unitTyped, to: label, lineBefore: line.text, lineAfter: '' };
      }
      plans.push({ line, name: ing.name.trim(), hasUnit: !!ing.unit, unitEdit, unitNote });
    }
    if (!plans.length) return;

    const known = { ...this.checks() };
    const missing = [...new Set(plans.map(p => p.name).filter(n => n && !known[n]))].slice(0, 100);
    if (missing.length) {
      const items = await new Promise<IngredientCheck[]>(resolve => this.storage.checkIngredients(missing).subscribe({ next: resolve, error: () => resolve([]) }));
      for (const c of items) known[c.name] = c;
    }

    const current = splitLines(this.text());
    const edits: TextEdit[] = [];
    const notes: Replacement[] = [];
    for (const plan of plans) {
      const now = current[plan.line.index];
      if (!now || now.text !== plan.line.text) continue; // the user kept typing: leave it
      const local: TextEdit[] = [];
      if (plan.unitEdit) local.push(plan.unitEdit);
      const target = plan.name && !this.declined.has(`n:${plan.name.toLowerCase()}`) ? autoTranslation(known[plan.name], plan.name, lang) : null;
      let nameSpan: { from: number; to: number } | null = null;
      if (target) {
        const unitEnd = plan.unitEdit ? plan.unitEdit.to : 0;
        const at = plan.line.text.toLowerCase().indexOf(plan.name.toLowerCase(), unitEnd);
        if (at >= 0) nameSpan = { from: at, to: at + plan.name.length };
      }
      if (target && nameSpan) local.push(nameReplacement(plan.line.text, nameSpan.from, nameSpan.to, target, lang, plan.hasUnit));
      if (!local.length) continue;
      const lineAfter = applyEdits(plan.line.text, local);
      if (plan.unitNote) notes.push({ ...plan.unitNote, lineAfter });
      if (target && nameSpan) notes.push({ kind: 'name', from: plan.name, to: target, lineBefore: plan.line.text, lineAfter });
      edits.push(...local.map(e => ({ ...e, from: e.from + now.start, to: e.to + now.start })));
    }
    if (!edits.length) return;
    this.commit(edits);
    for (const n of notes) this.record(n);
  }

  /** Put back what was typed before a rewrite, and leave that spelling alone from now on. */
  undo(r: Replacement): void {
    this.declined.add(`${r.kind === 'name' ? 'n' : 'u'}:${r.from.toLowerCase()}`);
    this.replaced.update(list => list.filter(x => x !== r));
    const lines = splitLines(this.text());
    const line = lines.find(l => l.text === r.lineAfter);
    if (line) {
      this.commit([{ from: line.start, to: line.end, insert: r.lineBefore }]);
      return;
    }
    // The line changed since: swap just the rewritten word.
    for (const l of lines) {
      const at = l.text.toLowerCase().lastIndexOf(r.to.toLowerCase());
      if (at >= 0) {
        this.commit([{ from: l.start + at, to: l.start + at + r.to.length, insert: r.from }]);
        return;
      }
    }
  }
}
