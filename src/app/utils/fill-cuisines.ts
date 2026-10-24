import type { CuisineSummary } from '../services';
import { normalizeSearch } from '../i18n/search';

/** localStorage key of the cuisines last chosen in "Fill empty dinners". */
export const FILL_CUISINES_KEY = 'mise_fill_cuisines';

/** Reads the remembered selection (never throws; storage may be blocked or hold junk). */
export function loadFillCuisines(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(FILL_CUISINES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function saveFillCuisines(names: readonly string[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(FILL_CUISINES_KEY, JSON.stringify(names));
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Keeps only cuisines the catalog knows (a remembered cuisine may have been removed). */
export function knownSelection(saved: readonly string[], cuisines: readonly CuisineSummary[]): string[] {
  const known = new Set(cuisines.map(c => c.name));
  return saved.filter((name, i) => known.has(name) && saved.indexOf(name) === i);
}

/** Toggles `name` in a selection (new array). */
export function toggleCuisine(selected: readonly string[], name: string): string[] {
  return selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name];
}

/** Region groups narrowed by a search over the cuisine's name in every language
 *  (`labels(name)` returns the display names to match, e.g. localized + English). Empty groups drop out. */
export function filterCuisineGroups<G extends { cuisines: CuisineSummary[] }>(groups: readonly G[], query: string, labels: (name: string) => string[]): G[] {
  const q = normalizeSearch(query.trim());
  if (!q) return [...groups];
  return groups
    .map(g => ({ ...g, cuisines: g.cuisines.filter(c => labels(c.name).some(l => normalizeSearch(l).includes(q))) }))
    .filter(g => g.cuisines.length > 0);
}

/** Dates in [start, end] that have no entry in `slot`. */
export function emptySlotDates(start: string, end: string, entries: readonly { date: string; slot: string }[], slot: string): string[] {
  const taken = new Set(entries.filter(e => e.slot === slot).map(e => e.date));
  const out: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!taken.has(iso)) out.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
