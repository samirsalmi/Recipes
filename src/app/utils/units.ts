// Display-only unit conversion for the recipe page's metric/US toggle. Spoons, pinches and
// count units are universal and pass through; mass and volume convert within their family.
import { unitCode } from '../i18n/units';
import { UnitSystem } from '../models';

export interface Amount {
  quantity: number | null;
  unit: string | null;
}

const G_PER_OZ = 28.3495;
const ML_PER_CUP = 240;
const ML_PER_TBSP = 15;
const ML_PER_TSP = 5;

export function toUnitSystem(amount: Amount, system: UnitSystem): Amount {
  const { quantity, unit } = amount;
  if (quantity === null || !unit) return amount;
  const u = unit.toLowerCase();
  if (system === 'us') {
    if (u === 'g' || u === 'kg') {
      const grams = u === 'kg' ? quantity * 1000 : quantity;
      const oz = grams / G_PER_OZ;
      return oz >= 16 ? { quantity: round(oz / 16, 0.25), unit: 'lb' } : { quantity: round(oz, oz < 4 ? 0.25 : 0.5), unit: 'oz' };
    }
    if (u === 'ml' || u === 'l') {
      const ml = u === 'l' ? quantity * 1000 : quantity;
      if (ml >= 60) return { quantity: round(ml / ML_PER_CUP, 0.25), unit: 'cup' };
      if (ml >= ML_PER_TBSP) return { quantity: round(ml / ML_PER_TBSP, 0.5), unit: 'tbsp' };
      return { quantity: round(ml / ML_PER_TSP, 0.25), unit: 'tsp' };
    }
    return amount;
  }
  // metric
  if (u === 'oz') return grams(quantity * G_PER_OZ);
  if (u === 'lb') return grams(quantity * 453.592);
  if (u === 'small cup' || unitCode(unit) === 'small cup') return millilitres(quantity * 120);
  if (u === 'cup') return millilitres(quantity * ML_PER_CUP);
  if (u === 'fl oz') return millilitres(quantity * 29.5735);
  return amount;
}

function grams(g: number): Amount {
  return g >= 1000 ? { quantity: round(g / 1000, 0.05), unit: 'kg' } : { quantity: round(g, g >= 100 ? 5 : 1), unit: 'g' };
}

function millilitres(ml: number): Amount {
  return ml >= 1000 ? { quantity: round(ml / 1000, 0.05), unit: 'l' } : { quantity: round(ml, ml >= 100 ? 5 : 1), unit: 'ml' };
}

function round(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}
