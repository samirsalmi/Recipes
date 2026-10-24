import { TestBed } from '@angular/core/testing';
import { GroceryItem } from '../../models';
import { GroceryItemComponent, groceryItemView } from './grocery-item.component';

function item(patch: Partial<GroceryItem> = {}): GroceryItem {
  return {
    key: 'egg', name: 'egg', aisle: 'dairy-eggs', state: 'to_buy', moreNeeded: false, staple: false, promoted: false,
    isNew: false, neededLabel: '6', remainingLabel: '6',
    parts: [{ key: 'egg|count:piece', family: 'count:piece', needed: 6, purchased: 0, remaining: 6, checked: false, neededLabel: '6', remainingLabel: '6' }],
    sources: [{ entryId: 1, date: '2026-10-21', slot: 'dinner', recipeId: 'shakshuka', recipeName: 'Shakshuka', servings: 4, amount: '6', addedBy: 2 }],
    ...patch,
  };
}

describe('groceryItemView', () => {
  it('to buy: unchecked, full amount, no pill', () => {
    expect(groceryItemView(item())).toEqual({ checked: false, amount: '6', morePill: null, boughtNote: null, dimmed: false, covered: false, needMore: null, atHomeNote: null });
  });

  it('in the cart: checked and dimmed', () => {
    const v = groceryItemView(item({ state: 'in_cart' }));
    expect(v.checked).toBe(true);
    expect(v.dimmed).toBe(true);
  });

  it('plan grew after buying: remaining amount + "+N more" pill', () => {
    const v = groceryItemView(item({
      moreNeeded: true, neededLabel: '10', remainingLabel: '4',
      parts: [{ key: 'egg|count:piece', family: 'count:piece', needed: 10, purchased: 6, remaining: 4, checked: true, neededLabel: '10', remainingLabel: '4' }],
    }));
    expect(v.amount).toBe('4');
    expect(v.morePill).toBe('+4 more');
    expect(v.boughtNote).toBeTruthy();
    expect(v.checked).toBe(false);
  });
});

describe('groceryItemView at home', () => {
  const partial = item({
    hasHave: true, remainingLabel: '3',
    parts: [{ key: 'egg|count:piece', family: 'count:piece', needed: 6, purchased: 0, remaining: 3, checked: false, have: 3, neededLabel: '6', remainingLabel: '3' }],
  });

  it('partially covered: full need stays, "need 3 more" shows', () => {
    const v = groceryItemView(partial);
    expect(v.amount).toBe('6');
    expect(v.needMore).toBe('need 3 more');
    expect(v.covered).toBe(false);
  });

  it('covered: checked, dimmed, no pill', () => {
    const v = groceryItemView(item({ state: 'covered', hasHave: true }));
    expect(v).toMatchObject({ checked: true, dimmed: true, covered: true, needMore: null });
  });

  it('renders the at-home note and opens the editor from a covered checkbox', async () => {
    await TestBed.configureTestingModule({ imports: [GroceryItemComponent] }).compileComponents();
    const fixture = TestBed.createComponent(GroceryItemComponent);
    fixture.componentRef.setInput('item', item({
      state: 'covered', hasHave: true,
      parts: [{ key: 'egg|count:piece', family: 'count:piece', needed: 6, purchased: 0, remaining: 0, checked: false, have: 6, haveAmount: { number: '6', unit: null, many: true }, neededAmount: { number: '6', unit: null, many: true }, neededLabel: '6', remainingLabel: '' }],
    }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-qa=at-home-note]')?.textContent).toContain('6 at home');
    expect(el.querySelector('[data-qa=have-editor]')).toBeNull();
    let toggled = false;
    fixture.componentInstance.toggled.subscribe(() => (toggled = true));
    (el.querySelector('[role=checkbox]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(toggled).toBe(false);
    expect(el.querySelector('[data-qa=have-stepper]')).toBeTruthy();
    expect((el.querySelector('[data-qa=have-input]') as HTMLInputElement).value).toBe('6');
  });

  it('staples flagged "I need it" offer "I have it"', async () => {
    await TestBed.configureTestingModule({ imports: [GroceryItemComponent] }).compileComponents();
    const fixture = TestBed.createComponent(GroceryItemComponent);
    fixture.componentRef.setInput('item', item({ promoted: true, pantryState: 'need' }));
    fixture.detectChanges();
    let back: GroceryItem | null = null;
    fixture.componentInstance.stapleHave.subscribe(i => (back = i));
    ((fixture.nativeElement as HTMLElement).querySelector('[data-qa=staple-have]') as HTMLButtonElement).click();
    expect(back).not.toBeNull();
  });
});

describe('GroceryItemComponent', () => {
  it('renders state, new dot, and expands sources on tap', async () => {
    await TestBed.configureTestingModule({ imports: [GroceryItemComponent] }).compileComponents();
    const fixture = TestBed.createComponent(GroceryItemComponent);
    fixture.componentRef.setInput('item', item({ isNew: true, moreNeeded: true, remainingLabel: '4' }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('.new-dot')).toBeTruthy();
    expect(el.textContent).toContain('+4 more needed');
    expect(el.textContent).not.toContain('Shakshuka');

    (el.querySelector('[data-qa=grocery-item-toggle]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Wed 21 dinner - Shakshuka (6)');

    let toggled: GroceryItem | null = null;
    fixture.componentInstance.toggled.subscribe(i => (toggled = i));
    (el.querySelector('[role=checkbox]') as HTMLButtonElement).click();
    expect(toggled).not.toBeNull();

    fixture.componentRef.setInput('item', item({ state: 'in_cart' }));
    fixture.detectChanges();
    expect(el.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.line-through')).toBeTruthy();
  });
});
