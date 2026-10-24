import { itemAmountLabel } from '../components/grocery-item/grocery-item.component';
import type { I18nService } from '../i18n/i18n.service';
import type { Language } from '../i18n/config';
import type { GroceryExtra, GroceryItem, GroceryTrip, OptionalExtra } from '../models';
import type { AisleGroup } from '../services/groceries.service';

/** The slice of I18nService the builder needs (so the spec can pass a stub). */
export type PdfLocalizer = Pick<I18nService, 't' | 'ingredientName' | 'aisle' | 'amountParts' | 'equivalent' | 'day' | 'n' | 'language'>;

export interface PdfRow {
  name: string;
  /** Remaining (to buy) or needed (done / covered) amount, already localized. */
  amount: string;
  /** Small muted line under the name ("200 g at home"). */
  note?: string;
  checked: boolean;
  /** The plan grew after shopping: the amount is shown in the accent colour. */
  more?: boolean;
}

export type PdfSectionKind = 'buy' | 'done' | 'covered';

export interface PdfSection {
  id: string;
  kind: PdfSectionKind;
  title: string;
  count: number;
  rows: PdfRow[];
}

export interface PdfNote {
  title: string;
  text: string;
}

/** Everything the PDF renderer draws; plain data, no Angular. */
export interface GroceryPdfModel {
  lang: Language;
  rtl: boolean;
  brand: string;
  title: string;
  /** "Tue 21 - Sun 26 · 9 meals" */
  range: string;
  household: string;
  generated: string;
  stats: { label: string; kind: 'buy' | 'done' }[];
  sections: PdfSection[];
  notes: PdfNote[];
  /** Shown instead of the sections when there is nothing at all to list. */
  emptyText: string | null;
  /** "Page {page} of {total}" template. */
  pageTemplate: string;
}

export interface GroceryPdfInput {
  trip: GroceryTrip | null;
  groups: AisleGroup[];
  /** Staples at home ("you probably have these"). */
  pantryHave: GroceryItem[];
  optionalExtras: OptionalExtra[];
  householdName: string;
  includeChecked: boolean;
  /** Local YYYY-MM-DD of "today" (printed in the header). */
  today: string;
}

const isDone = (i: GroceryItem) => i.state === 'in_cart';

/** What still has to be bought of an item: the remaining amount once some is at home or already
 *  bought, otherwise everything that is needed. */
function toBuyAmount(i: GroceryItem, l: PdfLocalizer): string {
  return i.moreNeeded || i.hasHave ? itemAmountLabel(i, 'remaining', l as I18nService, true) : itemAmountLabel(i, 'needed', l as I18nService, true);
}

function atHomeNote(i: GroceryItem, l: PdfLocalizer): string | undefined {
  const text = i.parts.filter(p => (p.have ?? 0) > 0).map(p => l.amountParts(p.haveAmount)).filter(Boolean).join(' + ');
  return text ? l.t('grocery.atHomeNote', { amount: text }) : undefined;
}

function extraRow(x: GroceryExtra, l: PdfLocalizer): PdfRow {
  return { name: l.ingredientName(x), amount: x.quantity ?? '', checked: x.checked };
}

/** Builds the PDF model from the grocery list: unchecked items per aisle (remaining amounts),
 *  then - when `includeChecked` - the items already in the cart and the ones covered by what is
 *  at home, then the staples / optional-extras notes. Pure; all text is localized here. */
export function buildGroceryPdfModel(input: GroceryPdfInput, l: PdfLocalizer): GroceryPdfModel {
  const sections: PdfSection[] = [];
  const done: PdfRow[] = [];
  const covered: PdfRow[] = [];

  for (const group of input.groups) {
    const buy: PdfRow[] = [
      ...group.items.filter(i => i.state === 'to_buy').map<PdfRow>(i => ({
        name: l.ingredientName(i), amount: toBuyAmount(i, l), note: i.hasHave ? atHomeNote(i, l) : undefined, checked: false, more: i.moreNeeded,
      })),
      ...group.extras.filter(x => !x.checked).map(x => extraRow(x, l)),
    ];
    if (buy.length) sections.push({ id: `buy-${group.aisle}`, kind: 'buy', title: l.aisle(group.aisle), count: buy.length, rows: buy });
    for (const i of group.items) {
      const row: PdfRow = { name: l.ingredientName(i), amount: itemAmountLabel(i, 'needed', l as I18nService, true), checked: true };
      if (isDone(i)) done.push(row);
      else if (i.state === 'covered') covered.push(row);
    }
    done.push(...group.extras.filter(x => x.checked).map(x => extraRow(x, l)));
  }

  const toBuyCount = sections.reduce((n, s) => n + s.count, 0);
  if (input.includeChecked) {
    if (done.length) sections.push({ id: 'done', kind: 'done', title: l.t('pdf.inCart'), count: done.length, rows: done });
    if (covered.length) sections.push({ id: 'covered', kind: 'covered', title: l.t('pdf.covered'), count: covered.length, rows: covered });
  }

  const sep = l.language() === 'ar' ? '، ' : ', ';
  const notes: PdfNote[] = [];
  if (input.pantryHave.length) {
    notes.push({
      title: l.t('pantry.title', { count: input.pantryHave.length }),
      text: input.pantryHave.map(i => l.ingredientName(i)).join(sep),
    });
  }
  if (input.optionalExtras.length) {
    notes.push({ title: l.t('groc.optTitle'), text: input.optionalExtras.map(o => l.ingredientName(o)).join(sep) });
  }

  const stats: GroceryPdfModel['stats'] = [{ label: l.t('pdf.stat.toBuy', { count: toBuyCount }), kind: 'buy' }];
  if (done.length) stats.push({ label: l.t('pdf.stat.done', { count: done.length }), kind: 'done' });

  const trip = input.trip;
  const dates = trip ? `${l.day(trip.start)} - ${l.day(trip.end)}` : '';
  const meals = trip ? l.t('common.meals', { count: trip.mealCount }) : '';
  return {
    lang: l.language(),
    rtl: l.language() === 'ar',
    brand: 'Mise',
    title: l.t('groc.shareTitle'),
    range: [dates, meals].filter(Boolean).join(' · '),
    household: input.householdName,
    generated: l.day(input.today, { day: 'numeric', month: 'short', year: 'numeric' }),
    stats,
    sections,
    notes,
    emptyText: sections.length ? null : l.t('pdf.empty'),
    pageTemplate: l.t('pdf.page', { page: '{page}', total: '{total}' }),
  };
}

/** Plain-text version of the same model (the "Copy as text" fallback and WhatsApp-style paste). */
export function groceryPdfModelToText(model: GroceryPdfModel): string {
  const head = [model.title, model.range].filter(Boolean).join(' - ');
  const lines = [head || model.title];
  for (const s of model.sections) {
    lines.push('', s.kind === 'buy' ? s.title : `${s.title} (${s.count})`);
    for (const r of s.rows) {
      const body = `${r.name}${r.amount ? ': ' + r.amount : ''}`;
      lines.push(s.kind === 'buy' ? `- ${body}` : `- [x] ${body}`);
    }
  }
  if (model.emptyText) lines.push('', model.emptyText);
  return lines.join('\n');
}
