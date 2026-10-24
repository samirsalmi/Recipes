import { AisleGroup } from '../services/groceries.service';
import { GroceryExtra, GroceryItem, GroceryPart } from '../models';
import { unitEquivalent } from './unit-equivalent';
import { PdfLocalizer, buildGroceryPdfModel, groceryPdfModelToText } from './grocery-pdf-model';

function part(patch: Partial<GroceryPart> = {}): GroceryPart {
  return {
    key: 'potato|count:piece', family: 'count:piece', needed: 6, purchased: 0, remaining: 6, checked: false, have: 0,
    neededLabel: '6', remainingLabel: '6',
    neededAmount: { number: '6', unit: null, many: true }, remainingAmount: { number: '6', unit: null, many: true }, ...patch,
  };
}

function item(name: string, patch: Partial<GroceryItem> = {}, partPatch: Partial<GroceryPart> = {}): GroceryItem {
  return {
    key: name, name, aisle: 'produce', state: 'to_buy', moreNeeded: false, staple: false, promoted: false, isNew: false,
    neededLabel: '6', remainingLabel: '6', parts: [part(partPatch)], sources: [], ...patch,
  };
}

function extra(name: string, checked = false, quantity: string | null = null): GroceryExtra {
  return { id: 1, name, quantity, aisle: 'produce', checked, checkedBy: null, addedBy: null };
}

function group(aisle: AisleGroup['aisle'], items: GroceryItem[], extras: GroceryExtra[] = []): AisleGroup {
  return { aisle, label: aisle, items, extras, remaining: 0 };
}

type Params = Record<string, unknown>;
const NAMES: Record<string, string> = { 'groc.shareTitle': 'Shopping list', 'pdf.inCart': 'In the cart', 'pdf.covered': 'At home', 'pdf.empty': 'Nothing' };
const l = (language: 'en' | 'fr' | 'ar' = 'en'): PdfLocalizer => ({
  language: (() => language) as PdfLocalizer['language'],
  t: ((key: string, params?: Params) => {
    if (key === 'pdf.stat.toBuy') return `To buy ${params?.['count']}`;
    if (key === 'pdf.stat.done') return `Done ${params?.['count']}`;
    if (key === 'pantry.title') return `Pantry ${params?.['count']}`;
    if (key === 'grocery.atHomeNote') return `${params?.['amount']} at home`;
    if (key === 'common.meals') return `${params?.['count']} meals`;
    if (key === 'pdf.page') return `Page ${params?.['page']} of ${params?.['total']}`;
    return NAMES[key] ?? key;
  }) as PdfLocalizer['t'],
  ingredientName: ((x: { name: string; names?: Record<string, string> | null }) => x.names?.[language] ?? x.name) as PdfLocalizer['ingredientName'],
  aisle: ((a: string) => `aisle:${a}`) as PdfLocalizer['aisle'],
  amountParts: ((a: { number: string; unit: string | null } | null | undefined) => (a ? `${a.number}${a.unit ? ' ' + a.unit : ''}` : '')) as PdfLocalizer['amountParts'],
  equivalent: ((q: number, u: string, c?: string) => {
    const e = unitEquivalent(q, u, c);
    if (!e) return '';
    const lbl = (u: string) => (u === 'l' ? 'L' : u);
    const parts = [`${e.approx ? '≈ ' : ''}${e.value} ${lbl(e.unit)}`];
    if (e.weight) parts.push(`≈ ${e.weight.value} ${lbl(e.weight.unit)}`);
    return `(${parts.join(' · ')})`;
  }) as PdfLocalizer['equivalent'],
  day: ((iso: string) => iso.slice(5)) as PdfLocalizer['day'],
  n: ((v: number) => String(v)) as PdfLocalizer['n'],
});

const base = { trip: { id: 1, start: '2026-10-21', end: '2026-10-25', createdAt: '', mealCount: 3 }, pantryHave: [], optionalExtras: [], householdName: 'Home', includeChecked: true, today: '2026-10-21' };

describe('buildGroceryPdfModel', () => {
  it('lists to-buy items per aisle with the header facts', () => {
    const m = buildGroceryPdfModel({ ...base, groups: [group('produce', [item('potato')]), group('dairy-eggs', [item('egg', { aisle: 'dairy-eggs' })])] }, l());
    expect(m.sections.map(s => s.title)).toEqual(['aisle:produce', 'aisle:dairy-eggs']);
    expect(m.sections[0].rows[0]).toMatchObject({ name: 'potato', amount: '6', checked: false });
    expect(m.range).toBe('10-21 - 10-25 · 3 meals');
    expect(m.household).toBe('Home');
    expect(m.stats[0].label).toBe('To buy 2');
    expect(m.emptyText).toBeNull();
    expect(m.rtl).toBe(false);
  });

  it('shows the remaining amount (after at-home and bought) with an at-home note', () => {
    const it1 = item('flour', { hasHave: true }, { have: 200, haveAmount: { number: '200', unit: 'g', many: true }, remainingAmount: { number: '300', unit: 'g', many: true }, neededAmount: { number: '500', unit: 'g', many: true } });
    const it2 = item('rice', { moreNeeded: true }, { remainingAmount: { number: '1', unit: 'kg', many: false } });
    const rows = buildGroceryPdfModel({ ...base, groups: [group('produce', [it1, it2])] }, l()).sections[0].rows;
    expect(rows[0]).toMatchObject({ amount: '300 g', note: '200 g at home' });
    expect(rows[1]).toMatchObject({ amount: '1 kg', more: true });
  });

  it('puts checked items and covered items after the to-buy aisles, and counts them', () => {
    const inCart = item('onion', { state: 'in_cart' });
    const covered = item('salt', { state: 'covered' });
    const m = buildGroceryPdfModel({ ...base, groups: [group('produce', [item('potato'), inCart, covered], [extra('soap', true), extra('tea', false, '2')])] }, l());
    expect(m.sections.map(s => `${s.kind}:${s.title}`)).toEqual(['buy:aisle:produce', 'done:In the cart', 'covered:At home']);
    expect(m.sections[0].rows.map(r => r.name)).toEqual(['potato', 'tea']);
    expect(m.sections[0].rows[1].amount).toBe('2');
    expect(m.sections[1].rows.map(r => [r.name, r.checked])).toEqual([['onion', true], ['soap', true]]);
    expect(m.stats.map(s => s.label)).toEqual(['To buy 2', 'Done 2']);
  });

  it('omits checked and covered sections when includeChecked is off', () => {
    const m = buildGroceryPdfModel({ ...base, includeChecked: false, groups: [group('produce', [item('potato'), item('onion', { state: 'in_cart' }), item('salt', { state: 'covered' })])] }, l());
    expect(m.sections.map(s => s.kind)).toEqual(['buy']);
    expect(JSON.stringify(m.sections)).not.toContain('onion');
  });

  it('uses localized names and right-to-left for Arabic', () => {
    const potato = item('potato', { names: { en: 'potato', fr: 'pomme de terre', ar: 'بطاطس' } });
    const m = buildGroceryPdfModel({ ...base, groups: [group('produce', [potato])] }, l('ar'));
    expect(m.sections[0].rows[0].name).toBe('بطاطس');
    expect(m.rtl).toBe(true);
    expect(m.lang).toBe('ar');
  });

  it('adds staples and optional extras as notes', () => {
    const m = buildGroceryPdfModel({ ...base, groups: [group('produce', [item('potato')])], pantryHave: [item('salt'), item('oil')], optionalExtras: [{ name: 'parsley' } as never] }, l());
    expect(m.notes.map(n => n.text)).toEqual(['salt, oil', 'parsley']);
    expect(m.notes[0].title).toBe('Pantry 2');
  });

  it('handles an empty list', () => {
    const m = buildGroceryPdfModel({ ...base, groups: [] }, l());
    expect(m.sections).toEqual([]);
    expect(m.emptyText).toBe('Nothing');
    expect(m.stats[0].label).toBe('To buy 0');
    expect(groceryPdfModelToText(m)).toContain('Nothing');
  });
});

describe('groceryPdfModelToText', () => {
  it('lists unchecked items plainly and checked ones as done', () => {
    const m = buildGroceryPdfModel({ ...base, groups: [group('produce', [item('potato'), item('onion', { state: 'in_cart' })])] }, l());
    expect(groceryPdfModelToText(m)).toBe(['Shopping list - 10-21 - 10-25 · 3 meals', '', 'aisle:produce', '- potato: 6', '', 'In the cart (1)', '- [x] onion: 6'].join('\n'));
  });
});

describe('buildGroceryPdfModel: metric equivalents', () => {
  const volume = (name: string, number: string, unit: string, needed: number) => item(name, {}, {
    key: `${name}|volume`, family: 'volume', needed, remaining: needed,
    neededAmount: { number, unit, many: true }, remainingAmount: { number, unit, many: true },
  });

  it('adds (30 ml) after kitchen volumes and a weight for dry ingredients', () => {
    const m = buildGroceryPdfModel({ ...base, groups: [group('pantry', [volume('olive oil', '2', 'tbsp', 30), volume('flour', '1', 'cup', 240)])] }, l());
    expect(m.sections[0].rows.map(r => r.amount)).toEqual(['2 tbsp (30 ml)', '1 cup (240 ml · ≈ 120 g)']);
    expect(groceryPdfModelToText(m)).toContain('- olive oil: 2 tbsp (30 ml)');
    expect(groceryPdfModelToText(m)).toContain('- flour: 1 cup (240 ml · ≈ 120 g)');
  });

  it('leaves metric and count amounts alone', () => {
    const m = buildGroceryPdfModel({ ...base, groups: [group('pantry', [volume('milk', '500', 'ml', 500), item('potato')])] }, l());
    expect(m.sections[0].rows.map(r => r.amount)).toEqual(['500 ml', '6']);
  });
});
