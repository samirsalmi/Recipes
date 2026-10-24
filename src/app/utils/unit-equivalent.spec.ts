import { equivalentName, unitEquivalent } from './unit-equivalent';

const eq = (q: number, u: string, c?: string) => unitEquivalent(q, u, c);

describe('unitEquivalent', () => {
  it('converts kitchen volumes to ml', () => {
    expect(eq(2, 'tbsp')).toEqual({ value: 30, unit: 'ml', approx: false });
    expect(eq(1, 'cup')).toEqual({ value: 240, unit: 'ml', approx: false });
    expect(eq(1, 'tsp')).toEqual({ value: 5, unit: 'ml', approx: false });
    expect(eq(1, 'fl oz')).toEqual({ value: 30, unit: 'ml', approx: false });
  });

  it('rounds sensibly and never fakes precision', () => {
    expect(eq(0.5, 'tsp')).toEqual({ value: 2.5, unit: 'ml', approx: false });
    expect(eq(0.25, 'tsp')?.value).toBe(1.5); // 1.25 -> nearest 0.5
    expect(eq(1 / 3, 'cup')?.value).toBe(80);
    expect(eq(1, 'pint')).toMatchObject({ value: 470, unit: 'ml' });
    expect(eq(1, 'quart')).toMatchObject({ value: 950, unit: 'ml' });
  });

  it('switches to litres from 1000 ml', () => {
    expect(eq(5, 'cup')).toEqual({ value: 1.2, unit: 'l', approx: false });
    expect(eq(1, 'gallon')).toEqual({ value: 3.8, unit: 'l', approx: false });
  });

  it('converts imperial weights to grams / kilograms', () => {
    expect(eq(4, 'oz')).toMatchObject({ value: 115, unit: 'g' });
    expect(eq(1, 'lb')).toMatchObject({ value: 455, unit: 'g' });
    expect(eq(3, 'lb')).toMatchObject({ value: 1.35, unit: 'kg' });
  });

  it('shows nothing for metric, count, pinch, handful and unknown units', () => {
    for (const u of ['g', 'kg', 'ml', 'l', 'clove', 'pinch', 'bunch', 'piece', 'slice', 'can', 'handful', 'فنجان-x', 'furlong']) {
      expect(eq(2, u), u).toBeNull();
    }
    expect(unitEquivalent(null, 'cup')).toBeNull();
    expect(unitEquivalent(0, 'cup')).toBeNull();
    expect(unitEquivalent(1, null)).toBeNull();
  });

  it('understands typed spellings in French and Arabic', () => {
    expect(eq(2, 'cuillère à soupe')?.value).toBe(30);
    expect(eq(1, 'ملعقة صغيرة')?.value).toBe(5);
  });

  it('uses a density for dry ingredients: weight, approximate', () => {
    // the exact volume stays, the weight is added
    expect(eq(1, 'cup', 'flour')).toEqual({ value: 240, unit: 'ml', approx: false, weight: { value: 120, unit: 'g' } });
    expect(eq(2, 'cup', 'flour')?.weight?.value).toBe(240); // scales with the quantity
    expect(eq(0.5, 'cup', 'butter')).toMatchObject({ value: 120, unit: 'ml', weight: { value: 115, unit: 'g' } });
    expect(eq(2, 'tbsp', 'butter')).toMatchObject({ value: 30, unit: 'ml', weight: { value: 28, unit: 'g' } });
    expect(eq(1, 'tsp', 'salt')?.weight).toEqual({ value: 6, unit: 'g' });
    expect(eq(1, 'tbsp', 'honey')?.weight?.value).toBe(21);
    expect(eq(3, 'cup', 'sugar')?.weight).toEqual({ value: 600, unit: 'g' });
    expect(eq(8, 'cup', 'sugar')).toMatchObject({ value: 1.9, unit: 'l', weight: { value: 1.6, unit: 'kg' } });
    expect(eq(1, 'small cup', 'flour')).toMatchObject({ value: 120, unit: 'ml', weight: { value: 60, unit: 'g' } });
  });

  it('small cup is 120 ml', () => {
    expect(eq(1, 'small cup')).toEqual({ value: 120, unit: 'ml', approx: false });
    expect(eq(3, 'فنجان')).toEqual({ value: 360, unit: 'ml', approx: false });
    expect(eq(2, 'coffee cup')?.value).toBe(240);
    expect(eq(1, 'cup')?.value).toBe(240);
  });

  it('keeps liquids and unknown ingredients in ml', () => {
    for (const c of ['water', 'milk', 'olive oil', 'cream', 'stock', 'mystery']) {
      expect(eq(1, 'cup', c), c).toEqual({ value: 240, unit: 'ml', approx: false });
    }
  });

  it('converts ml of a dense solid, but not ml of anything else', () => {
    expect(eq(240, 'ml', 'flour')).toEqual({ value: 120, unit: 'g', approx: true });
    expect(eq(240, 'ml', 'water')).toBeNull();
  });

  it('skips the density for cooked variants', () => {
    expect(equivalentName({ name: 'cooked rice', canonical: 'rice' })).toBeUndefined();
    expect(equivalentName({ name: 'rice', canonical: 'rice' })).toBe('rice');
  });
});
