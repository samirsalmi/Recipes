/** Canonical unit codes (what the backend returns in grocery amounts and what the ingredient
 *  parser produces) and the spellings that map to them. Display labels live in the
 *  dictionaries under `unit.<code>` (+ plural suffixes). Unknown units are shown as typed. */
export const UNIT_CODES = [
  'g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'small cup', 'cup', 'fl oz',
  'pinch', 'clove', 'can', 'bunch', 'slice', 'piece', 'sprig', 'stick', 'leaf', 'handful',
] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

const ALIASES: Record<string, UnitCode> = {
  g: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g', gr: 'g', 'غ': 'g', 'غرام': 'g', 'جرام': 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg', kilogramme: 'kg', 'كغ': 'kg', 'كيلو': 'kg', 'كيلوغرام': 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', 'أونصة': 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', 'رطل': 'lb',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml', 'مل': 'ml',
  l: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', 'لتر': 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', 'c. a cafe': 'tsp', 'c. a c.': 'tsp', cac: 'tsp', 'ملعقة صغيرة': 'tsp', 'ملاعق صغيرة': 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', 'c. a soupe': 'tbsp', 'c. a s.': 'tbsp', cas: 'tbsp', 'ملعقة كبيرة': 'tbsp', 'ملاعق كبيرة': 'tbsp',
  'small cup': 'small cup', 'small cups': 'small cup', cup: 'cup', cups: 'cup', tasse: 'cup', tasses: 'cup', 'كوب': 'cup', 'أكواب': 'cup',
  'fl oz': 'fl oz',
  pinch: 'pinch', pinches: 'pinch', pincee: 'pinch', 'قرصة': 'pinch', 'رشة': 'pinch',
  clove: 'clove', cloves: 'clove', gousse: 'clove', gousses: 'clove', 'فص': 'clove', 'فصوص': 'clove',
  can: 'can', cans: 'can', tin: 'can', tins: 'can', boite: 'can', 'علبة': 'can', 'علب': 'can',
  bunch: 'bunch', bunches: 'bunch', botte: 'bunch', bouquet: 'bunch', 'حزمة': 'bunch', 'باقة': 'bunch',
  slice: 'slice', slices: 'slice', tranche: 'slice', tranches: 'slice', 'شريحة': 'slice', 'شرائح': 'slice',
  piece: 'piece', pieces: 'piece', whole: 'piece', pc: 'piece', pcs: 'piece', morceau: 'piece', morceaux: 'piece', 'قطعة': 'piece', 'قطع': 'piece', 'حبة': 'piece',
  sprig: 'sprig', sprigs: 'sprig', brin: 'sprig', 'غصن': 'sprig',
  stick: 'stick', sticks: 'stick', 'عود': 'stick',
  leaf: 'leaf', leaves: 'leaf', feuille: 'leaf', feuilles: 'leaf', 'ورقة': 'leaf', 'أوراق': 'leaf',
  handful: 'handful', handfuls: 'handful', poignee: 'handful', 'حفنة': 'handful',
};

/** Loose spoken / spelled-out variants of the common units, shared with the ingredient parser
 *  (`src/app/utils/ingredient-parser.ts`): "table spoon", "soup spoon", "big spoon", "tea spoon",
 *  "small spoon", "coffee spoon", "glass"; French "petite cuillère", "grande cuillère", "cuillère à
 *  thé"; Arabic "فنجان" (a coffee cup: the 120 ml small cup), "قبضة". */
export const EXTRA_UNIT_SPELLINGS: readonly (readonly [string, UnitCode])[] = [
  ['table spoons', 'tbsp'], ['table spoon', 'tbsp'], ['tablespoonfuls', 'tbsp'], ['tablespoonful', 'tbsp'],
  ['tblsp', 'tbsp'], ['tbl', 'tbsp'], ['tbsps', 'tbsp'], ['soup spoons', 'tbsp'], ['soup spoon', 'tbsp'],
  ['big spoons', 'tbsp'], ['big spoon', 'tbsp'], ['large spoons', 'tbsp'], ['large spoon', 'tbsp'],
  ['grandes cuillères', 'tbsp'], ['grande cuillère', 'tbsp'], ['cuillères à soupe', 'tbsp'], ['cuillère à soupe', 'tbsp'],
  ['cuillères à café', 'tsp'], ['cuillère à café', 'tsp'],
  ['tea spoons', 'tsp'], ['tea spoon', 'tsp'], ['teaspoonfuls', 'tsp'], ['teaspoonful', 'tsp'], ['tsps', 'tsp'], ['tspn', 'tsp'],
  ['small spoons', 'tsp'], ['small spoon', 'tsp'], ['little spoons', 'tsp'], ['little spoon', 'tsp'],
  ['coffee spoons', 'tsp'], ['coffee spoon', 'tsp'],
  ['petites cuillères', 'tsp'], ['petite cuillère', 'tsp'], ['cuillères à thé', 'tsp'], ['cuillère à thé', 'tsp'], ['c. à thé', 'tsp'],
  ['glasses', 'cup'], ['glass', 'cup'], ['verres', 'cup'], ['verre', 'cup'], ['كاس', 'cup'], ['كؤوس', 'cup'],
  ['coffee cups', 'small cup'], ['coffee cup', 'small cup'], ['tea cups', 'small cup'], ['tea cup', 'small cup'], ['teacups', 'small cup'], ['teacup', 'small cup'],
  ['demi-tasses', 'small cup'], ['demi-tasse', 'small cup'], ['demi tasses', 'small cup'], ['demi tasse', 'small cup'],
  ['tasses à café', 'small cup'], ['tasse à café', 'small cup'], ['tasses à thé', 'small cup'], ['tasse à thé', 'small cup'],
  ['petites tasses', 'small cup'], ['petite tasse', 'small cup'], ['كوب صغير', 'small cup'], ['أكواب صغيرة', 'small cup'],
  ['فنجان', 'small cup'], ['فناجين', 'small cup'],
  ['قبضة', 'handful'], ['قبضات', 'handful'], ['حفنات', 'handful'], ['pincées', 'pinch'], ['رشات', 'pinch'],
  ['boîtes', 'can'], ['boîte', 'can'], ['bunches', 'bunch'], ['حزم', 'bunch'], ['باقات', 'bunch'],
];

/** A dessert spoon is about two teaspoons: the parser reads it as 2 tsp per spoon. */
export const DESSERT_SPOON_SPELLINGS: readonly string[] = [
  'dessert spoons', 'dessert spoon', 'cuillères à dessert', 'cuillère à dessert', 'ملعقة حلو', 'ملاعق حلو',
];

function fold(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '');
}

const FOLDED: Record<string, UnitCode> = {};
const WRITTEN: Record<string, string> = {}; // folded spelling -> as written
for (const [spelling, code] of [...Object.entries(ALIASES), ...EXTRA_UNIT_SPELLINGS]) {
  FOLDED[fold(spelling)] = code;
  WRITTEN[fold(spelling)] = spelling;
}

/** The canonical code for a typed/stored unit, or null when it is not a known unit. */
export function unitCode(unit: string | null | undefined): UnitCode | null {
  if (!unit) return null;
  return FOLDED[fold(unit)] ?? null;
}

/** Units whose typed spelling starts with `partial` ("tab" -> tbsp, "tea" -> tsp), best first, with
 *  the spelling that matched. Needs two characters; the spelling must be longer than what was typed. */
export function suggestUnits(partial: string, limit = 5): { code: UnitCode; matched: string }[] {
  const needle = fold(partial);
  if (needle.length < 2 || needle.length > 20) return [];
  const best = new Map<UnitCode, string>();
  for (const [spelling, code] of Object.entries(FOLDED)) {
    if (spelling.length <= needle.length || !spelling.startsWith(needle)) continue;
    const current = best.get(code);
    if (current === undefined || spelling.length < current.length) best.set(code, spelling);
  }
  return [...best.entries()]
    .sort((a, b) => a[1].length - b[1].length || UNIT_CODES.indexOf(a[0]) - UNIT_CODES.indexOf(b[0]))
    .slice(0, limit)
    .map(([code, matched]) => ({ code, matched: WRITTEN[matched] ?? matched }));
}
