import { loadAllDictionaries } from '../i18n/dictionaries';
import { CuisineSummary } from '../services';
import { FILL_CUISINES_KEY, emptySlotDates, filterCuisineGroups, knownSelection, loadFillCuisines, saveFillCuisines, toggleCuisine } from './fill-cuisines';

const c = (name: string): CuisineSummary => ({ name, slug: name.toLowerCase(), region: null, count: 1, image: '' });
const store = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[FILL_CUISINES_KEY, initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

beforeAll(() => loadAllDictionaries());

describe('fill cuisines helpers', () => {
  it('toggles a cuisine in and out without mutating', () => {
    const a = ['Thai'];
    expect(toggleCuisine(a, 'Greek')).toEqual(['Thai', 'Greek']);
    expect(toggleCuisine(a, 'Thai')).toEqual([]);
    expect(a).toEqual(['Thai']);
  });

  it('remembers the selection and survives junk or blocked storage', () => {
    const s = store();
    saveFillCuisines(['Thai', 'Greek'], s);
    expect(loadFillCuisines(s)).toEqual(['Thai', 'Greek']);
    expect(loadFillCuisines(store('not json'))).toEqual([]);
    expect(loadFillCuisines(store('{"a":1}'))).toEqual([]);
    expect(loadFillCuisines(store('[1,"Thai"]'))).toEqual(['Thai']);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadFillCuisines(blocked)).toEqual([]);
    expect(() => saveFillCuisines(['Thai'], blocked)).not.toThrow();
    expect(loadFillCuisines(null)).toEqual([]);
  });

  it('drops remembered cuisines the catalog no longer has', () => {
    expect(knownSelection(['Thai', 'Gone', 'Thai'], [c('Thai'), c('Greek')])).toEqual(['Thai']);
  });

  it('filters region groups by name in any language, accent-insensitively', () => {
    const groups = [{ region: 'Europe', cuisines: [c('Algerian'), c('Greek')] }, { region: 'Asia', cuisines: [c('Thai')] }];
    const labels = (n: string) => [n === 'Algerian' ? 'Algérienne' : n, n];
    expect(filterCuisineGroups(groups, '', labels)).toHaveLength(2);
    expect(filterCuisineGroups(groups, 'algerienne', labels).map(g => g.cuisines.map(x => x.name))).toEqual([['Algerian']]);
    expect(filterCuisineGroups(groups, 'zzz', labels)).toEqual([]);
  });

  it('lists the dates without an entry in the slot', () => {
    const entries = [{ date: '2026-10-20', slot: 'dinner' }, { date: '2026-10-21', slot: 'lunch' }];
    expect(emptySlotDates('2026-10-19', '2026-10-22', entries, 'dinner')).toEqual(['2026-10-19', '2026-10-21', '2026-10-22']);
    expect(emptySlotDates('2026-10-23', '2026-10-22', entries, 'dinner')).toEqual([]);
  });
});
