// Display-only "metric equivalent" for kitchen units: "2 tbsp (30 ml)", "1 cup flour (240 ml · ≈ 120 g)".
// Pure; never used for grocery merging or stored data.
import { unitCode } from '../i18n/units';

export type EquivalentUnit = 'ml' | 'l' | 'g' | 'kg';

export interface UnitEquivalent {
  value: number;
  unit: EquivalentUnit;
  /** True when `value` itself is a derived weight (ml / l of a dense solid): shown with "≈". */
  approx: boolean;
  /** For a kitchen volume of a dry / solid ingredient with a known density: the approximate
   *  weight, shown after the exact volume ("240 ml · ≈ 120 g"). */
  weight?: { value: number; unit: 'g' | 'kg' };
}

/** Millilitres per kitchen volume unit (US customary; the cup is the metric 240 ml cup the app uses, the small cup an app convention of 120 ml). */
const ML: Record<string, number> = { tsp: 5, tbsp: 15, 'small cup': 120, cup: 240, 'fl oz': 29.5735, pint: 473.176, quart: 946.353, gallon: 3785.41 };
/** Grams per imperial weight unit. */
const G: Record<string, number> = { oz: 28.3495, lb: 453.592 };

/** Spellings of the big US volumes, which the shared unit table does not know. */
const EXTRA_VOLUMES: Record<string, string> = {
  pt: 'pint', pint: 'pint', pints: 'pint', qt: 'quart', quart: 'quart', quarts: 'quart', gal: 'gallon', gallon: 'gallon', gallons: 'gallon',
};

/** Grams per US cup (240 ml) for the dry / solid ingredients where a volume-to-weight rule is
 *  reliable, keyed by the English canonical name (`backend/app/ingredients.py`). Liquids (water,
 *  milk, oil, cream, stock) are deliberately absent: they stay in ml. */
export const GRAMS_PER_CUP: Readonly<Record<string, number>> = {
  flour: 120,
  semolina: 167,
  sugar: 200,
  'brown sugar': 213,
  'icing sugar': 120,
  butter: 227,
  rice: 185,
  couscous: 175,
  oats: 90,
  'cocoa powder': 85,
  honey: 340,
  salt: 292,
  cornstarch: 128,
  lentils: 192,
  'baking powder': 230,
  breadcrumbs: 108,
  raisins: 150,
  'tomato paste': 260,
};

function step(value: number, increment: number): number {
  return Number((Math.round(value / increment) * increment).toFixed(2));
}

function roundMl(ml: number): { value: number; unit: 'ml' | 'l' } {
  const r = ml < 10 ? step(ml, 0.5) : ml < 250 ? step(ml, 5) : step(ml, 10);
  if (r >= 1000) return { value: Math.max(1, step(ml / 1000, 0.05)), unit: 'l' };
  return { value: Math.max(0.5, r), unit: 'ml' };
}

function roundGrams(g: number): { value: number; unit: 'g' | 'kg' } {
  const r = g < 10 ? step(g, 0.5) : g < 50 ? step(g, 1) : step(g, 5);
  if (r >= 1000) return { value: Math.max(1, step(g / 1000, 0.05)), unit: 'kg' };
  return { value: Math.max(0.5, r), unit: 'g' };
}

/** The parenthetical equivalent of an amount, or null when none applies:
 *  - tsp / tbsp / small cup / cup / fl oz / pint / quart / gallon -> ml (L from 1000 ml); for a dry
 *    or solid ingredient with a known density (`canonical`) the approximate grams (kg) too, as `weight`;
 *  - oz / lb -> g (kg);
 *  - ml / l of a dense solid -> grams (approx); metric units themselves, count units, pinches and
 *    handfuls, and units whose size varies by region show nothing. */
export function unitEquivalent(quantity: number | null | undefined, unit: string | null | undefined, canonical?: string | null): UnitEquivalent | null {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity) || quantity <= 0 || !unit) return null;
  const code: string | null = unitCode(unit) ?? EXTRA_VOLUMES[unit.trim().toLowerCase()] ?? null;
  if (!code) return null;
  const perCup = canonical ? GRAMS_PER_CUP[canonical.trim().toLowerCase()] : undefined;
  if (code in ML) {
    const ml = quantity * ML[code];
    const volume = { ...roundMl(ml), approx: false };
    return perCup ? { ...volume, weight: roundGrams((ml / 240) * perCup) } : volume;
  }
  if ((code === 'ml' || code === 'l') && perCup) {
    return { ...roundGrams(((code === 'l' ? quantity * 1000 : quantity) / 240) * perCup), approx: true };
  }
  if (code in G) return { ...roundGrams(quantity * G[code]), approx: false };
  return null;
}

/** The canonical name to look a density up by: none for cooked / steamed variants (their weight
 *  per cup differs from the raw ingredient's). */
export function equivalentName(ing: { canonical?: string; name: string }): string | undefined {
  return /(cooked|steamed|boiled)/i.test(ing.name) ? undefined : ing.canonical;
}
