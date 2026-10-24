import { AmountParts, GroceryItem, GroceryList, GroceryPart } from '../models';

/** Pure helpers for "I have N at home" (partial amounts) and pantry staples: unit handling for
 *  the stepper, number parsing, and the local (optimistic) recomputation that mirrors
 *  backend/app/groceries.py `_part_state()` / `build_list()`. The server stays the source of
 *  truth: its response replaces whatever these helpers predicted. */

const EPSILON = 1e-6;

/** Factor to the family's base unit (g for mass, ml for volume), as in backend/app/groceries.py. */
const UNIT_FACTOR: Record<string, number> = {
  g: 1, kg: 1000, oz: 28.3495, lb: 453.592,
  ml: 1, l: 1000, tsp: 5, tbsp: 15, 'small cup': 120, cup: 240, 'fl oz': 29.5735,
};

const FAMILY_UNITS: Record<string, string[]> = {
  mass: ['g', 'kg', 'oz', 'lb'],
  volume: ['ml', 'l', 'tsp', 'tbsp', 'small cup', 'cup', 'fl oz'],
};

const UNIT_STEP: Record<string, number> = {
  g: 50, kg: 0.25, oz: 1, lb: 0.25, ml: 50, l: 0.25, tsp: 0.5, tbsp: 0.5, 'small cup': 0.5, cup: 0.25, 'fl oz': 1,
};

/** Units the user can pick for a part's family ([] for counts and unquantified parts). */
export function familyUnits(family: string): string[] {
  return FAMILY_UNITS[family] ?? [];
}

export function isQuantified(part: GroceryPart): boolean {
  return part.needed !== null && part.family !== 'unquantified';
}

/** The unit the editor starts in: the one the need is shown in (kg, tbsp...), else g / ml.
 *  null for count families (the count unit is implied by the part). */
export function editorUnit(part: GroceryPart): string | null {
  const units = familyUnits(part.family);
  if (!units.length) return null;
  const shown = part.neededAmount?.unit ?? null;
  return shown && units.includes(shown) ? shown : units[0];
}

export function toBase(value: number, unit: string | null): number {
  return value * (unit ? (UNIT_FACTOR[unit] ?? 1) : 1);
}

export function fromBase(base: number, unit: string | null): number {
  return base / (unit ? (UNIT_FACTOR[unit] ?? 1) : 1);
}

/** Stepper increment: 1 for counts, a kitchen-friendly step per unit otherwise. */
export function stepFor(unit: string | null): number {
  return unit ? (UNIT_STEP[unit] ?? 1) : 1;
}

/** Rounds away binary noise (0.1 + 0.2) and trims trailing zeros: 1.5, 250, 0.25. */
export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampQuantity(value: number): number {
  return Math.min(Math.max(roundQuantity(value), 0), 1_000_000);
}

/** Parses what the user typed: Western or Arabic-Indic digits, "," or "." as the decimal mark,
 *  "1/2" and "1 1/2". Returns null when it is not a non-negative number. */
export function parseQuantity(text: string): number | null {
  let s = text
    .trim()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,،٫]/g, '.');
  if (!s) return null;
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[3]) ? clampQuantity(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) : null;
  const fraction = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return Number(fraction[2]) ? clampQuantity(Number(fraction[1]) / Number(fraction[2])) : null;
  s = s.replace(/\s+/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) && value >= 0 ? clampQuantity(value) : null;
}

/** A number for the input box (no thousands separators, at most 2 decimals). */
export function formatQuantity(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** `{number, unit, many}` for a base-unit amount of a part, in the unit the need is shown in. */
export function amountFor(base: number, part: GroceryPart): AmountParts | null {
  if (!isQuantified(part) || base <= EPSILON) return null;
  const unit = editorUnit(part);
  if (unit) return { number: formatQuantity(fromBase(base, unit)), unit, many: false };
  const countUnit = part.family.includes(':') ? part.family.split(':')[1] : 'piece';
  const whole = Math.max(1, Math.ceil(base - 0.05));
  return { number: String(whole), unit: countUnit === 'piece' ? null : countUnit, many: whole > 1 };
}

function tolerance(needed: number): number {
  return Math.max(0.001, needed * 0.005);
}

/** remaining for one part, as in the server: needed - have - purchased, never below 0. */
export function partRemaining(part: GroceryPart, have: number): number | null {
  if (part.needed === null) return null;
  if (!part.checked) {
    const remaining = Math.max(part.needed - have, 0);
    return have > 0 && remaining <= tolerance(part.needed) ? 0 : remaining;
  }
  if (part.purchased === null) return 0;
  const remaining = Math.max(part.needed - have - part.purchased, 0);
  return remaining <= tolerance(part.needed) ? 0 : remaining;
}

function partDone(part: GroceryPart, remaining: number | null): boolean {
  return remaining === null ? part.checked : remaining <= EPSILON;
}

const countedForProgress = (item: GroceryItem) => item.state !== 'no_longer_needed' && !item.staple;
const isDone = (item: GroceryItem) => item.state === 'in_cart' || item.state === 'covered';

/** Local prediction of the list after setting the have-amount (base unit; null clears) of a
 *  part. Returns the same list when the part is not found (an at-home memory entry is dropped). */
export function applyHave(list: GroceryList, partKey: string, base: number | null): GroceryList {
  const have = base !== null && base > EPSILON ? base : 0;
  let changed = false;
  let doneDelta = 0;
  const items = list.items.map(item => {
    if (!item.parts.some(p => p.key === partKey)) return item;
    changed = true;
    const parts = item.parts.map(p => {
      if (p.key !== partKey) return p;
      const remaining = partRemaining(p, have);
      return {
        ...p,
        have,
        haveAmount: amountFor(have, p),
        remaining,
        remainingAmount: remaining !== null && remaining > EPSILON ? amountFor(remaining, p) : null,
      };
    });
    const allDone = parts.every(p => partDone(p, p.remaining));
    const anyHave = parts.some(p => (p.have ?? 0) > EPSILON);
    const anyMark = parts.some(p => p.checked);
    const state: GroceryItem['state'] = !allDone ? 'to_buy' : anyHave && !anyMark ? 'covered' : 'in_cart';
    const moreNeeded = !allDone && parts.some(p => !partDone(p, p.remaining) && p.purchased !== null && p.purchased > EPSILON);
    const next = { ...item, parts, state, moreNeeded, hasHave: anyHave };
    if (countedForProgress(item)) doneDelta += Number(isDone(next)) - Number(isDone(item));
    return next;
  });
  const atHome = (list.atHome ?? []).filter(e => e.key !== partKey || have > EPSILON);
  if (!changed && atHome.length === (list.atHome ?? []).length) return list;
  const progress = { ...list.progress, done: Math.max(0, list.progress.done + doneDelta) };
  return { ...list, items, atHome, progress };
}

/** Local prediction of "I need it" / "I have it" on a pantry staple (it joins or leaves the
 *  progress count). */
export function applyStaple(list: GroceryList, key: string, promoted: boolean): GroceryList {
  const target = list.items.find(i => i.key === key);
  if (!target || !!target.promoted === promoted) return list;
  const counts = target.state !== 'no_longer_needed';
  const sign = promoted ? 1 : -1;
  const progress = counts
    ? { done: Math.max(0, list.progress.done + sign * Number(isDone(target))), total: Math.max(0, list.progress.total + sign) }
    : list.progress;
  return {
    ...list,
    progress,
    items: list.items.map(item =>
      item.key !== key ? item : { ...item, promoted, staple: !promoted, pantryState: promoted ? 'need' : 'have' }
    ),
  };
}

/** Local prediction of adding an item to / removing it from the household staples.
 *  Adding keeps the row on this shop's list as "needed" (`promoted !== false`) or tucks it into
 *  the pantry; removing makes it an ordinary item again (it rejoins the progress count when it
 *  was tucked away). Mirrors POST /api/groceries/household-staples. */
export function applyHouseholdStaple(list: GroceryList, key: string, staple: boolean, promoted?: boolean): GroceryList {
  const target = list.items.find(i => i.key === key);
  if (!target) return list;
  if (staple) {
    if (target.pantryState) return promoted === undefined ? list : applyStaple(list, key, promoted);
    if (target.state === 'no_longer_needed') return list;
    if (promoted === false) {
      const progress = { done: Math.max(0, list.progress.done - Number(isDone(target))), total: Math.max(0, list.progress.total - 1) };
      return { ...list, progress, items: list.items.map(i => (i.key !== key ? i : { ...i, promoted: false, staple: true, pantryState: 'have' })) };
    }
    return { ...list, items: list.items.map(i => (i.key !== key ? i : { ...i, promoted: true, staple: false, pantryState: 'need' })) };
  }
  if (!target.pantryState) return list;
  const rejoins = target.pantryState === 'have' && target.state !== 'no_longer_needed';
  const progress = rejoins
    ? { done: list.progress.done + Number(isDone(target)), total: list.progress.total + 1 }
    : list.progress;
  return { ...list, progress, items: list.items.map(i => (i.key !== key ? i : { ...i, promoted: false, staple: false, pantryState: null })) };
}

/** Whether a covered/partial state should show the "need X more" note on a line. */
export function needsMore(item: GroceryItem): boolean {
  return !!item.hasHave && item.state === 'to_buy';
}
