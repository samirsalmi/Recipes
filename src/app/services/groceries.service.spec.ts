import { GroceryExtra, GroceryItem } from '../models';
import { aisleRemaining } from './groceries.service';

const item = (state: GroceryItem['state']) => ({ key: state, state }) as GroceryItem;
const extra = (checked: boolean) => ({ id: 1, name: 'x', checked }) as GroceryExtra;

describe('aisleRemaining', () => {
  it('counts to-buy items and unchecked extras, not in-cart items or checked extras', () => {
    expect(aisleRemaining([item('to_buy'), item('in_cart')], [extra(false), extra(true)])).toBe(2);
  });

  it('an aisle of only unchecked extras is not "(0)"', () => {
    expect(aisleRemaining([], [extra(false), extra(false)])).toBe(2);
  });
});
