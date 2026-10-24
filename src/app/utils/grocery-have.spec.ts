import { GroceryItem, GroceryList, GroceryPart } from '../models';
import {
  amountFor, applyHave, applyHouseholdStaple, applyStaple, clampQuantity, editorUnit, familyUnits, fromBase, parseQuantity, partRemaining, stepFor, toBase,
} from './grocery-have';

function part(patch: Partial<GroceryPart> = {}): GroceryPart {
  return {
    key: 'potato|count:piece', family: 'count:piece', needed: 6, purchased: 0, remaining: 6, checked: false, have: 0,
    neededLabel: '6', remainingLabel: '6', neededAmount: { number: '6', unit: null, many: true }, ...patch,
  };
}

function item(patch: Partial<GroceryItem> = {}): GroceryItem {
  return {
    key: 'potato', name: 'potato', aisle: 'produce', state: 'to_buy', moreNeeded: false, staple: false, promoted: false,
    isNew: false, neededLabel: '6', remainingLabel: '6', parts: [part()], sources: [], ...patch,
  };
}

function list(items: GroceryItem[], patch: Partial<GroceryList> = {}): GroceryList {
  return {
    trip: { id: 1, start: '2026-10-21', end: '2026-10-25', createdAt: '', mealCount: 1 }, items, extras: [], optionalExtras: [],
    atHome: [], progress: { done: 0, total: items.length }, units: 'metric', ...patch,
  };
}

describe('quantity helpers', () => {
  it('parses typed numbers in several notations and rejects junk', () => {
    expect(parseQuantity('3')).toBe(3);
    expect(parseQuantity(' 1,5 ')).toBe(1.5);
    expect(parseQuantity('٣')).toBe(3);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
    expect(parseQuantity('1/0')).toBeNull();
    expect(parseQuantity('99999999')).toBe(1_000_000);
  });

  it('converts within a unit family and keeps count steps whole', () => {
    expect(toBase(0.2, 'kg')).toBe(200);
    expect(fromBase(240, 'cup')).toBe(1);
    expect(familyUnits('mass')).toContain('oz');
    expect(familyUnits('count:clove')).toEqual([]);
    expect(stepFor(null)).toBe(1);
    expect(stepFor('g')).toBe(50);
    expect(clampQuantity(0.1 + 0.2)).toBe(0.3);
    expect(clampQuantity(-4)).toBe(0);
  });

  it('starts the editor in the unit the need is shown in', () => {
    expect(editorUnit(part())).toBeNull();
    expect(editorUnit(part({ family: 'mass', neededAmount: { number: '1.5', unit: 'kg', many: false } }))).toBe('kg');
    expect(editorUnit(part({ family: 'volume', neededAmount: null }))).toBe('ml');
  });

  it('formats an optimistic amount like the server (counts round up)', () => {
    expect(amountFor(3, part())).toEqual({ number: '3', unit: null, many: true });
    expect(amountFor(1, part({ family: 'count:clove' }))).toEqual({ number: '1', unit: 'clove', many: false });
    expect(amountFor(1500, part({ family: 'mass', neededAmount: { number: '2', unit: 'kg', many: false } }))).toEqual({ number: '1.5', unit: 'kg', many: false });
    expect(amountFor(0, part())).toBeNull();
  });
});

describe('partRemaining', () => {
  it('is needed - have - purchased, never negative', () => {
    expect(partRemaining(part(), 3)).toBe(3);
    expect(partRemaining(part(), 9)).toBe(0);
    expect(partRemaining(part({ checked: true, purchased: 2 }), 3)).toBe(1);
    expect(partRemaining(part({ checked: true, purchased: null }), 0)).toBe(0);
    expect(partRemaining(part({ needed: null, remaining: null }), 3)).toBeNull();
  });
});

describe('applyHave', () => {
  it('"I have 3" of 6 leaves 3 to buy and the line stays to-buy', () => {
    const next = applyHave(list([item()]), 'potato|count:piece', 3);
    const potato = next.items[0];
    expect(potato.state).toBe('to_buy');
    expect(potato.hasHave).toBe(true);
    expect(potato.parts[0].have).toBe(3);
    expect(potato.parts[0].remaining).toBe(3);
    expect(potato.parts[0].remainingAmount).toEqual({ number: '3', unit: null, many: true });
    expect(next.progress.done).toBe(0);
  });

  it('covering the need moves the line to covered and counts it as done; clearing reverts', () => {
    const covered = applyHave(list([item()]), 'potato|count:piece', 6);
    expect(covered.items[0].state).toBe('covered');
    expect(covered.progress).toEqual({ done: 1, total: 1 });
    const cleared = applyHave(covered, 'potato|count:piece', null);
    expect(cleared.items[0].state).toBe('to_buy');
    expect(cleared.items[0].hasHave).toBe(false);
    expect(cleared.progress.done).toBe(0);
  });

  it('keeps purchases separate: bought 3 + have 3 is in the cart, have 1 re-opens it', () => {
    const bought = item({ state: 'in_cart', parts: [part({ checked: true, purchased: 3, remaining: 0, have: 3 })], hasHave: true });
    const l = list([bought], { progress: { done: 1, total: 1 } });
    expect(applyHave(l, 'potato|count:piece', 3).items[0].state).toBe('in_cart');
    const lower = applyHave(l, 'potato|count:piece', 1);
    expect(lower.items[0].state).toBe('to_buy');
    expect(lower.items[0].moreNeeded).toBe(true);
    expect(lower.items[0].parts[0].purchased).toBe(3);
    expect(lower.progress.done).toBe(0);
  });

  it('leaves other items alone, drops a cleared at-home memory entry, and ignores staples in progress', () => {
    const staple = item({ key: 'salt', staple: true, pantryState: 'have', parts: [part({ key: 'salt|count:piece' })] });
    const l = list([item(), staple], {
      atHome: [{ key: 'carrot|count:piece', itemKey: 'carrot', name: 'carrot', family: 'count:piece', have: 2, haveAmount: null }],
      progress: { done: 0, total: 1 },
    });
    const next = applyHave(l, 'potato|count:piece', 6);
    expect(next.items[1]).toBe(staple);
    expect(next.progress).toEqual({ done: 1, total: 1 });
    expect(applyHave(l, 'carrot|count:piece', null).atHome).toEqual([]);
    expect(applyHave(l, 'unknown|mass', 2)).toBe(l);
  });
});

describe('applyStaple', () => {
  const salt = item({ key: 'salt', staple: true, pantryState: 'have', parts: [] });

  it('"I need it" joins the list and the progress count; "I have it" puts it back', () => {
    const l = list([salt], { progress: { done: 0, total: 0 } });
    const need = applyStaple(l, 'salt', true);
    expect(need.items[0]).toMatchObject({ promoted: true, staple: false, pantryState: 'need' });
    expect(need.progress.total).toBe(1);
    const back = applyStaple(need, 'salt', false);
    expect(back.items[0]).toMatchObject({ promoted: false, staple: true, pantryState: 'have' });
    expect(back.progress.total).toBe(0);
  });

  it('is idempotent', () => {
    const l = list([salt]);
    expect(applyStaple(l, 'salt', false)).toBe(l);
  });
});

describe('applyHouseholdStaple', () => {
  it('adding a needed item keeps it on the list as a needed staple, progress unchanged', () => {
    const l = list([item()]);
    const next = applyHouseholdStaple(l, 'potato', true);
    expect(next.items[0]).toMatchObject({ pantryState: 'need', promoted: true, staple: false, state: 'to_buy' });
    expect(next.progress).toEqual(l.progress);
  });

  it('adding with promoted=false tucks it into the pantry and leaves the count', () => {
    const next = applyHouseholdStaple(list([item()]), 'potato', true, false);
    expect(next.items[0]).toMatchObject({ pantryState: 'have', staple: true, promoted: false });
    expect(next.progress.total).toBe(0);
  });

  it('removing makes an ordinary item again, rejoining the count when it was tucked away', () => {
    const tucked = item({ staple: true, pantryState: 'have' });
    const next = applyHouseholdStaple(list([tucked], { progress: { done: 0, total: 0 } }), 'potato', false);
    expect(next.items[0]).toMatchObject({ pantryState: null, staple: false, promoted: false });
    expect(next.progress.total).toBe(1);
    const needed = item({ promoted: true, pantryState: 'need' });
    expect(applyHouseholdStaple(list([needed]), 'potato', false).progress.total).toBe(1);
  });

  it('is idempotent and ignores unknown items', () => {
    const l = list([item()]);
    expect(applyHouseholdStaple(l, 'potato', false)).toBe(l);
    expect(applyHouseholdStaple(l, 'nope', true)).toBe(l);
    const already = applyHouseholdStaple(l, 'potato', true);
    expect(applyHouseholdStaple(already, 'potato', true)).toBe(already);
  });
});
