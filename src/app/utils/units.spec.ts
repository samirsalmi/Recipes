import { toUnitSystem } from './units';

describe('toUnitSystem', () => {
  it('converts metric to US for display', () => {
    expect(toUnitSystem({ quantity: 500, unit: 'g' }, 'us')).toEqual({ quantity: 1, unit: 'lb' });
    expect(toUnitSystem({ quantity: 100, unit: 'g' }, 'us')).toEqual({ quantity: 3.5, unit: 'oz' });
    expect(toUnitSystem({ quantity: 250, unit: 'ml' }, 'us')).toEqual({ quantity: 1, unit: 'cup' });
    expect(toUnitSystem({ quantity: 30, unit: 'ml' }, 'us')).toEqual({ quantity: 2, unit: 'tbsp' });
  });

  it('converts US to metric and leaves spoons and counts alone', () => {
    expect(toUnitSystem({ quantity: 2, unit: 'cup' }, 'metric')).toEqual({ quantity: 480, unit: 'ml' });
    expect(toUnitSystem({ quantity: 1, unit: 'فنجان' }, 'metric')).toEqual({ quantity: 120, unit: 'ml' });
    expect(toUnitSystem({ quantity: 2, unit: 'small cup' }, 'metric')).toEqual({ quantity: 240, unit: 'ml' });
    expect(toUnitSystem({ quantity: 1, unit: 'lb' }, 'metric')).toEqual({ quantity: 455, unit: 'g' });
    expect(toUnitSystem({ quantity: 2, unit: 'tbsp' }, 'us')).toEqual({ quantity: 2, unit: 'tbsp' });
    expect(toUnitSystem({ quantity: 3, unit: 'clove' }, 'metric')).toEqual({ quantity: 3, unit: 'clove' });
    expect(toUnitSystem({ quantity: null, unit: null }, 'us')).toEqual({ quantity: null, unit: null });
  });
});
