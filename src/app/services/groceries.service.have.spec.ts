import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { GroceryList } from '../models';
import { GroceriesService } from './groceries.service';
import { StorageService } from './storage.service';

function list(have: number, remaining: number): GroceryList {
  return {
    trip: { id: 1, start: '2026-10-21', end: '2026-10-25', createdAt: '', mealCount: 1 },
    items: [
      {
        key: 'potato', name: 'potato', aisle: 'produce', state: 'to_buy', moreNeeded: false, staple: false, promoted: false, isNew: false,
        neededLabel: '6', remainingLabel: String(remaining), hasHave: have > 0,
        parts: [{ key: 'potato|count:piece', family: 'count:piece', needed: 6, purchased: 0, remaining, checked: false, have, neededLabel: '6', remainingLabel: String(remaining) }],
        sources: [],
      },
      {
        key: 'olive oil', name: 'olive oil', aisle: 'pantry', state: 'to_buy', moreNeeded: false, staple: true, promoted: false, pantryState: 'have', isNew: false,
        neededLabel: '1 tbsp', remainingLabel: '1 tbsp', parts: [], sources: [],
      },
    ],
    extras: [], optionalExtras: [], atHome: [], progress: { done: 0, total: 1 }, units: 'metric',
  };
}

describe('GroceriesService have-at-home and staples', () => {
  let storage: { setHouseholdStaple: ReturnType<typeof vi.fn>; getHousehold: ReturnType<typeof vi.fn>; setGroceryHave: ReturnType<typeof vi.fn>; setStaplePromoted: ReturnType<typeof vi.fn>; getGroceries: ReturnType<typeof vi.fn>; markGroceryItem: ReturnType<typeof vi.fn> };
  let service: GroceriesService;

  beforeEach(() => {
    storage = { setHouseholdStaple: vi.fn(), getHousehold: vi.fn(() => of(null)), setGroceryHave: vi.fn(), setStaplePromoted: vi.fn(), getGroceries: vi.fn(() => of(list(0, 6))), markGroceryItem: vi.fn(() => of(list(0, 0))) };
    TestBed.configureTestingModule({ providers: [{ provide: StorageService, useValue: storage }] });
    service = TestBed.inject(GroceriesService);
    (service as unknown as { listSignal: { set(l: GroceryList): void } }).listSignal.set(list(0, 6));
  });

  it('updates the list optimistically, then takes the server list', () => {
    const seen: number[] = [];
    storage.setGroceryHave.mockImplementation(() => {
      seen.push(service.list()!.items[0].parts[0].have!); // already optimistic when the request is made
      return of(list(3, 3));
    });
    service.setHave('potato|count:piece', 3, null).subscribe();
    expect(seen).toEqual([3]);
    expect(storage.setGroceryHave).toHaveBeenCalledWith('potato|count:piece', 3, null);
    expect(service.list()!.items[0].parts[0].remaining).toBe(3);
  });

  it('rolls back when the request fails', () => {
    storage.setGroceryHave.mockReturnValue(throwError(() => new Error('offline')));
    let failed = false;
    service.setHave('potato|count:piece', 3, null).subscribe({ error: () => (failed = true) });
    expect(failed).toBe(true);
    expect(service.list()!.items[0].parts[0].have).toBe(0);
    expect(service.list()!.items[0].parts[0].remaining).toBe(6);
  });

  it('checks an item off at once and rolls back if the server refuses', () => {
    const request = new Subject<GroceryList>();
    storage.markGroceryItem.mockReturnValue(request);
    let failed = false;
    service.mark('potato').subscribe({ error: () => (failed = true) });
    expect(service.list()!.items[0].state).toBe('in_cart');
    expect(service.progress()).toEqual({ done: 1, total: 1 });
    request.error(new Error('offline'));
    expect(failed).toBe(true);
    expect(service.list()!.items[0].state).toBe('to_buy');
    expect(service.progress()).toEqual({ done: 0, total: 1 });
  });

  it('sends the typed unit to the server and clears with null', () => {
    storage.setGroceryHave.mockReturnValue(of(list(0, 6)));
    service.setHave('potato|count:piece', null, null).subscribe();
    expect(storage.setGroceryHave).toHaveBeenCalledWith('potato|count:piece', null, null);
  });

  it('flips a staple and rolls it back on error; pantry lists staples with their state', () => {
    expect(service.pantry().map(i => [i.key, i.pantryState])).toEqual([['olive oil', 'have']]);
    storage.setStaplePromoted.mockReturnValue(throwError(() => new Error('nope')));
    service.setStaplePromoted('olive oil', true).subscribe({ error: () => undefined });
    expect(service.pantry()[0].pantryState).toBe('have');
    storage.setStaplePromoted.mockImplementation(() => {
      expect(service.pantry()[0].pantryState).toBe('need');
      return of(list(0, 6));
    });
    service.setStaplePromoted('olive oil', true).subscribe();
  });

  it('adds a needed item to the staples optimistically (stays on the list), refreshes the household, rolls back on error', () => {
    storage.setHouseholdStaple.mockReturnValue(throwError(() => new Error('nope')));
    service.setHouseholdStaple('potato', true).subscribe({ error: () => undefined });
    expect(service.list()!.items[0]).toMatchObject({ promoted: false, staple: false });
    expect(storage.getHousehold).not.toHaveBeenCalled();
    storage.setHouseholdStaple.mockImplementation(() => {
      expect(service.list()!.items[0]).toMatchObject({ pantryState: 'need', promoted: true, staple: false });
      expect(service.list()!.items[0].state).toBe('to_buy'); // not silently gone
      return of(list(0, 6));
    });
    service.setHouseholdStaple('potato', true).subscribe();
    expect(storage.setHouseholdStaple).toHaveBeenLastCalledWith('potato', true, undefined);
    expect(storage.getHousehold).toHaveBeenCalled();
  });

  it('removing a pantry staple predicts an ordinary item and rolls back on error', () => {
    storage.setHouseholdStaple.mockReturnValue(throwError(() => new Error('nope')));
    service.setHouseholdStaple('olive oil', false).subscribe({ error: () => undefined });
    expect(service.pantry().map(i => i.key)).toEqual(['olive oil']);
    storage.setHouseholdStaple.mockImplementation(() => {
      expect(service.pantry()).toEqual([]);
      return of(list(0, 6));
    });
    service.setHouseholdStaple('olive oil', false).subscribe();
  });

  it('only the latest edit of a part wins when responses arrive out of order', () => {
    const first = new Subject<GroceryList>();
    const second = new Subject<GroceryList>();
    storage.setGroceryHave.mockReturnValueOnce(first).mockReturnValueOnce(second);
    service.setHave('potato|count:piece', 1, null).subscribe();
    service.setHave('potato|count:piece', 4, null).subscribe();
    second.next(list(4, 2));
    first.next(list(1, 5)); // stale response arrives late
    expect(service.list()!.items[0].parts[0].have).toBe(4);
  });
});
