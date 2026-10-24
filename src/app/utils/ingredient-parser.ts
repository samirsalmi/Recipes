import { DESSERT_SPOON_SPELLINGS, EXTRA_UNIT_SPELLINGS } from '../i18n/units';
import { Ingredient } from '../models';

// Turns free-text ingredient lines (pasted into the add-recipe form, or imported from a URL)
// into structured ingredients: quantity / unit / name / note / group / optional.
// Handles "1 1/2", "½", "1½", "1-2" (ranges keep the upper bound, the lower one is kept in
// quantityMin), "2 cups flour, sifted", "a pinch of salt", "salt to taste", "Sauce:" group
// headers, "(optional)" / "optional:" markers, and common French units
// (c. à soupe, c. à café, gousse, pincée...). Lines can also be written in French
// ("250 g de farine", "2 c. à s. d'huile") or Modern Standard Arabic ("٢ ملعقة كبيرة زيت",
// "نصف كوب دقيق"): Arabic-Indic digits, the Arabic comma, tashkeel/tatweel, "de/d'/du/des/من"
// particles and Arabic units are understood. Unknown units are left in the name.

export interface ParsedIngredient extends Omit<Ingredient, 'aisle'> {
  /** Lower bound when the line gave a range ("1-2 onions" -> quantityMin 1, quantity 2). */
  quantityMin?: number;
  /** The original line, for the form's "how we read it" chips. */
  raw: string;
  /** The unit exactly as typed ("table spoon"), when the line had a recognized one. */
  unitTyped?: string;
  /** Typed unit converted into `unit` at this factor (dessert spoon -> 2 tsp, cl -> 10 ml); absent = 1. */
  unitFactor?: number;
}

export type ParsedLine =
  | { kind: 'group'; group: string; raw: string }
  | { kind: 'ingredient'; ingredient: ParsedIngredient };

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5,
  '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};

const FOLD_CHARS: Record<string, string> = {
  à: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', î: 'i', ï: 'i', ô: 'o', ö: 'o', ù: 'u', û: 'u', ü: 'u', ç: 'c',
  أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ى: 'ي', ة: 'ه',
};

/** Lowercase and fold accents / Arabic letter variants one character for one character, so an
 *  index in the folded text is an index in the original (units are matched on the folded text). */
function fold(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) out += FOLD_CHARS[ch] ?? ch;
  return out;
}

/** Arabic-Indic digits and separators to ASCII, tashkeel and tatweel dropped, Arabic comma to ",". */
function prepare(line: string): string {
  return line
    .normalize('NFC')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, '')
    .replace(/\u060c/g, ',')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u00a0\u2007\u202f\u200b]/g, ' ');
}

const ARABIC_LETTER = '\\u0621-\\u064a';

// Longest spellings first so "c. à soupe" wins over "c".
const UNIT_SYNONYMS: [string, string][] = ([
  ['cuillères à soupe', 'tbsp'], ['cuillère à soupe', 'tbsp'], ['cuilleres a soupe', 'tbsp'], ['cuillere a soupe', 'tbsp'],
  ['cuillères à café', 'tsp'], ['cuillère à café', 'tsp'], ['cuilleres a cafe', 'tsp'], ['cuillere a cafe', 'tsp'],
  ['c. à soupe', 'tbsp'], ['c. a soupe', 'tbsp'], ['c à soupe', 'tbsp'], ['c.à.s.', 'tbsp'], ['c.à.s', 'tbsp'], ['càs', 'tbsp'], ['cas', 'tbsp'], ['cs', 'tbsp'],
  ['c. à café', 'tsp'], ['c. a cafe', 'tsp'], ['c à café', 'tsp'], ['c.à.c.', 'tsp'], ['c.à.c', 'tsp'], ['càc', 'tsp'], ['cac', 'tsp'], ['cc', 'tsp'],
  ['tablespoons', 'tbsp'], ['tablespoon', 'tbsp'], ['tbsp.', 'tbsp'], ['tbsp', 'tbsp'], ['tbs', 'tbsp'],
  ['teaspoons', 'tsp'], ['teaspoon', 'tsp'], ['tsp.', 'tsp'], ['tsp', 'tsp'],
  ['fluid ounces', 'fl oz'], ['fl. oz.', 'fl oz'], ['fl oz', 'fl oz'],
  ['kilograms', 'kg'], ['kilogram', 'kg'], ['kilos', 'kg'], ['kilo', 'kg'], ['kg', 'kg'],
  ['grams', 'g'], ['gram', 'g'], ['grammes', 'g'], ['gramme', 'g'], ['gr', 'g'], ['g', 'g'],
  ['milliliters', 'ml'], ['millilitres', 'ml'], ['milliliter', 'ml'], ['millilitre', 'ml'], ['ml', 'ml'],
  ['centilitres', 'cl'], ['cl', 'cl'], ['dl', 'dl'],
  ['liters', 'l'], ['litres', 'l'], ['liter', 'l'], ['litre', 'l'], ['l', 'l'],
  ['ounces', 'oz'], ['ounce', 'oz'], ['oz', 'oz'],
  ['pounds', 'lb'], ['pound', 'lb'], ['lbs', 'lb'], ['lb', 'lb'],
  ['small cups', 'small cup'], ['small cup', 'small cup'], ['cups', 'cup'], ['cup', 'cup'], ['tasses', 'cup'], ['tasse', 'cup'], ['verres', 'cup'], ['verre', 'cup'],
  ['pinches', 'pinch'], ['pinch', 'pinch'], ['pincées', 'pinch'], ['pincée', 'pinch'], ['pincees', 'pinch'], ['pincee', 'pinch'],
  ['cloves', 'clove'], ['clove', 'clove'], ['gousses', 'clove'], ['gousse', 'clove'],
  ['cans', 'can'], ['can', 'can'], ['tins', 'can'], ['tin', 'can'], ['boîtes', 'can'], ['boîte', 'can'], ['boites', 'can'], ['boite', 'can'],
  ['bunches', 'bunch'], ['bunch', 'bunch'], ['bottes', 'bunch'], ['botte', 'bunch'],
  ['slices', 'slice'], ['slice', 'slice'], ['tranches', 'slice'], ['tranche', 'slice'],
  ['pieces', 'piece'], ['piece', 'piece'], ['pcs', 'piece'],
  ['portions', 'portion'], ['portion', 'portion'], ['parts', 'portion'], ['part', 'portion'],
  ['sprigs', 'sprig'], ['sprig', 'sprig'], ['brins', 'sprig'], ['brin', 'sprig'],
  ['sticks', 'stick'], ['stick', 'stick'],
  ['leaves', 'leaf'], ['leaf', 'leaf'], ['feuilles', 'leaf'], ['feuille', 'leaf'],
  ['handfuls', 'handful'], ['handful', 'handful'], ['poignées', 'handful'], ['poignée', 'handful'],
  // more French
  ['c. à s.', 'tbsp'], ['c. à s', 'tbsp'], ['c à s', 'tbsp'], ['c.a.s', 'tbsp'], ['c. à c.', 'tsp'], ['c. à c', 'tsp'], ['c à c', 'tsp'], ['c.a.c', 'tsp'],
  ['kilogrammes', 'kg'], ['kilogramme', 'kg'], ['décilitres', 'dl'], ['décilitre', 'dl'], ['centilitre', 'cl'],
  ['bouquets', 'bunch'], ['bouquet', 'bunch'], ['morceaux', 'piece'], ['morceau', 'piece'], ['rondelles', 'slice'], ['rondelle', 'slice'],
  ['branches', 'sprig'], ['branche', 'sprig'], ['bâtons', 'stick'], ['bâton', 'stick'],
  // Modern Standard Arabic
  ['ملاعق كبيرة', 'tbsp'], ['ملعقة كبيرة', 'tbsp'], ['ملاعق طعام', 'tbsp'], ['ملعقة طعام', 'tbsp'],
  ['ملاعق صغيرة', 'tsp'], ['ملعقة صغيرة', 'tsp'], ['ملاعق شاي', 'tsp'], ['ملعقة شاي', 'tsp'],
  ['أكواب', 'cup'], ['كوب', 'cup'], ['كأس', 'cup'], ['كاسات', 'cup'],
  ['كيلوغرام', 'kg'], ['كيلوجرام', 'kg'], ['كيلو', 'kg'], ['كغم', 'kg'], ['كجم', 'kg'], ['كغ', 'kg'],
  ['غرامات', 'g'], ['غرام', 'g'], ['جرامات', 'g'], ['جرام', 'g'], ['غم', 'g'], ['جم', 'g'], ['غ', 'g'],
  ['ملليلتر', 'ml'], ['مليلتر', 'ml'], ['مل', 'ml'], ['لترات', 'l'], ['لتر', 'l'], ['ل', 'l'],
  ['سنتيلتر', 'cl'], ['ديسيلتر', 'dl'], ['أونصة', 'oz'], ['أوقية', 'oz'], ['رطل', 'lb'],
  ['قرصات', 'pinch'], ['قرصة', 'pinch'], ['رشات', 'pinch'], ['رشة', 'pinch'],
  ['فصوص', 'clove'], ['فص', 'clove'], ['علب', 'can'], ['علبة', 'can'],
  ['حزم', 'bunch'], ['حزمة', 'bunch'], ['باقات', 'bunch'], ['باقة', 'bunch'],
  ['حصص', 'portion'], ['حصة', 'portion'], ['شرائح', 'slice'], ['شريحة', 'slice'], ['حبات', 'piece'], ['حبة', 'piece'], ['قطع', 'piece'], ['قطعة', 'piece'],
  ['أغصان', 'sprig'], ['غصن', 'sprig'], ['أعواد', 'stick'], ['عود', 'stick'],
  ['ورقات', 'leaf'], ['أوراق', 'leaf'], ['ورقة', 'leaf'], ['حفنات', 'handful'], ['حفنة', 'handful'],
] as [string, string][])
  .concat(EXTRA_UNIT_SPELLINGS.map(([spelling, unit]) => [spelling, unit] as [string, string]))
  .concat(DESSERT_SPOON_SPELLINGS.map(spelling => [spelling, 'dessert'] as [string, string]))
  .map(([spelling, unit]) => [fold(spelling), unit] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, un: 1, une: 1, two: 2, deux: 2, three: 3, trois: 3, half: 0.5, demi: 0.5, demie: 0.5,
};

// Arabic number words, keyed in folded form (see fold()).
const ARABIC_WORD_NUMBERS: Record<string, number> = {
  واحد: 1, واحده: 1, اثنان: 2, اثنين: 2, اثنتان: 2, اثنتين: 2, ثلاثه: 3, اربعه: 4, خمسه: 5,
  نصف: 0.5, ربع: 0.25, ثلث: 1 / 3,
};

const TO_TASTE = /\b(to taste|as needed|as required|selon (le )?go[uû]t|au go[uû]t|for serving|for garnish|q\.?s\.?)\b/i;
const TO_TASTE_AR = /(حسب الذوق|حسب الرغبة|حسب الحاجة|للتزيين|للتقديم)/;
const OPTIONAL_WORD = '(?:optional|facultatif|facultative|optionnel|optionnelle|اختياري|اختيارية)';
// "of": English, French (de, du, des, d', de la, de l') and Arabic (من).
const OF_PARTICLE = /^\s*(?:of|de la|de l|des|du|de|d|من)(?=\s|['’]|$)/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "1 1/2" | "1½" | "½" | "1.5" | "1,5" | "3/4" at the start of `text` -> [value, rest]. */
function readNumber(text: string): [number, string] | null {
  const m = text.match(/^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
  if (m) {
    return [(m[1] ? parseInt(m[1], 10) : 0) + UNICODE_FRACTIONS[m[2]], text.slice(m[0].length)];
  }
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed && +mixed[3] !== 0) {
    return [+mixed[1] + +mixed[2] / +mixed[3], text.slice(mixed[0].length)];
  }
  const frac = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac && +frac[2] !== 0) return [+frac[1] / +frac[2], text.slice(frac[0].length)];
  const dec = text.match(/^(\d+(?:[.,]\d+)?)/);
  if (dec) return [parseFloat(dec[1].replace(',', '.')), text.slice(dec[0].length)];
  return null;
}

/** Leading quantity incl. ranges ("1-2", "1 to 2", "1 à 2") and word numbers ("a pinch"). */
function readQuantity(text: string): { min?: number; value: number; rest: string } | null {
  const first = readNumber(text);
  if (first) {
    const [value, rest] = first;
    const range = rest.match(/^\s*(?:-|–|—|to|à|a)\s*/i);
    if (range) {
      const second = readNumber(rest.slice(range[0].length));
      if (second && second[0] >= value) {
        return { min: value, value: second[0], rest: second[1] };
      }
    }
    return { value, rest };
  }
  const word = text.match(/^([a-zé]+)(?=\s|$)\s*/i);
  if (word && WORD_NUMBERS[word[1].toLowerCase()] !== undefined) {
    const rest = text.slice(word[0].length);
    // "a pinch of salt" / "an onion": only when followed by something.
    if (rest.trim()) return { value: WORD_NUMBERS[word[1].toLowerCase()], rest };
  }
  const arabic = text.match(new RegExp(`^([${ARABIC_LETTER}]+)(?=\\s|$)\\s*`));
  if (arabic && ARABIC_WORD_NUMBERS[fold(arabic[1])] !== undefined) {
    const rest = text.slice(arabic[0].length);
    if (rest.trim()) return { value: ARABIC_WORD_NUMBERS[fold(arabic[1])], rest };
  }
  return null;
}

function readUnit(text: string): [string, string] | null {
  // "T" (capital) is the tablespoon, "t" the teaspoon in recipe shorthand; the folded matching
  // below is case-blind, so catch the capital first.
  const cap = text.match(/^T(?=\s|$)/);
  if (cap) return ['tbsp', text.slice(1)];
  const folded = fold(text);
  for (const [spelling, unit] of UNIT_SYNONYMS) {
    const re = new RegExp(`^${escapeRe(spelling)}(?![a-zà-ÿ${ARABIC_LETTER}])\\.?`);
    const m = folded.match(re);
    if (m) return [unit, text.slice(m[0].length)];
  }
  return null;
}

// Serving words: "4 portions de fromage" is just 4 cheeses (a plain count); the word is kept as a note.
const SERVING_WORDS = new Set([
  'portion', 'portions', 'part', 'parts', 'piece', 'pieces', 'slice', 'slices', 'tranche', 'tranches',
  'morceau', 'morceaux', 'حصه', 'حصص', 'قطعه', 'قطع', 'شريحه', 'شرائح',
]);

/** A serving word at the end of the name ("fromage portions") -> [unit, name without it, word]. Needs at
 *  least one other word, and stops at a comma/parenthesis (those are notes). */
function readTrailingUnit(text: string): [string, string, string] | null {
  const m = text.match(/^([^,(]*\S)\s+(\S+)\s*$/);
  if (!m || !SERVING_WORDS.has(fold(m[2]))) return null;
  return ['', m[1], m[2]];
}

function cleanName(text: string): string {
  return text
    .replace(/^\s*(?:(?:of|de la|des|du|de|من)\s+|(?:de l|d|l)['’]\s*)/i, '')
    .replace(/^\s*[-–:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse one line. Returns null for blank lines. */
export function parseIngredientLine(line: string): ParsedLine | null {
  const raw = line.trim();
  let text = prepare(raw).replace(/^[-*•·▪◦]\s*/, '').trim();
  if (!text) return null;

  // "Sauce:" / "For the dressing:" -> group header.
  if (/:\s*$/.test(text) && !new RegExp(`^${OPTIONAL_WORD}\\s*:`, 'i').test(text)) {
    return { kind: 'group', group: text.replace(/:\s*$/, '').replace(/^(?:for the|pour (?:la|le|les)|pour l['’])\s*/i, '').trim(), raw };
  }

  let optional = false;
  const optPrefix = text.match(new RegExp(`^${OPTIONAL_WORD}\\s*:\\s*`, 'i'));
  if (optPrefix) {
    optional = true;
    text = text.slice(optPrefix[0].length);
  }
  const optSuffix = text.match(new RegExp(`\\s*[(,]\\s*${OPTIONAL_WORD}\\s*\\)?\\s*$`, 'i'));
  if (optSuffix) {
    optional = true;
    text = text.slice(0, optSuffix.index).trim();
  }

  const notes: string[] = [];
  // "salt to taste" / "pepper, to taste"
  const taste = text.match(TO_TASTE) ?? text.match(TO_TASTE_AR);
  if (taste) {
    notes.push(taste[0].toLowerCase());
    text = (text.slice(0, taste.index) + text.slice((taste.index ?? 0) + taste[0].length)).replace(/[,\s]+$/, '').trim();
  }

  let quantity: number | null = null;
  let quantityMin: number | undefined;
  let unit: string | null = null;
  let servingNote: string | null = null;
  let unitTyped: string | null = null;
  let unitFactor = 1;
  const q = readQuantity(text);
  if (q) {
    quantity = q.value;
    quantityMin = q.min;
    text = q.rest.trim();
    // "1 (400 g) can tomatoes": the parenthesis is a note.
    const paren = text.match(/^\(([^)]*)\)\s*/);
    if (paren) {
      notes.unshift(paren[1].trim());
      text = text.slice(paren[0].length);
    }
    const u = readUnit(text);
    if (u) {
      unit = u[0];
      const typed = text.slice(0, text.length - u[1].length).trim();
      if (SERVING_WORDS.has(fold(typed))) {
        servingNote = typed;
        unit = null;
      } else {
        unitTyped = typed;
      }
      text = u[1];
    }
  } else {
    // "pinch of salt" without a number
    const u = readUnit(text);
    // "pinch of salt" / "une pincée de sel" / "رشة ملح" (Arabic needs no particle).
    if (u && (OF_PARTICLE.test(u[1]) || (['pinch', 'handful'].includes(u[0]) && new RegExp(`^\\s*[${ARABIC_LETTER}]`).test(u[1])))) {
      unit = u[0];
      unitTyped = text.slice(0, text.length - u[1].length).trim();
      quantity = 1;
      text = u[1];
    }
  }
  // "4 fromage portions" / "4 cheese slices" / "4 جبن قطع": a count word trailing the name is the unit.
  if (quantity !== null && !unit && !servingNote) {
    const trailing = readTrailingUnit(text);
    if (trailing) {
      servingNote = trailing[2];
      text = trailing[1];
    }
  }
  if (unit === 'dessert') {
    unit = 'tsp';
    unitFactor = 2;
    if (quantity !== null) {
      quantity *= 2;
      quantityMin = quantityMin !== undefined ? quantityMin * 2 : undefined;
    }
  }
  if (unit === 'cl' && quantity !== null) {
    unitFactor = 10;
    quantity = quantity * 10;
    quantityMin = quantityMin !== undefined ? quantityMin * 10 : undefined;
    unit = 'ml';
  } else if (unit === 'dl' && quantity !== null) {
    unitFactor = 100;
    quantity = quantity * 100;
    quantityMin = quantityMin !== undefined ? quantityMin * 100 : undefined;
    unit = 'ml';
  }

  text = cleanName(text);
  // Trailing "(...)" and everything after the first comma are notes.
  const tailParen = text.match(/\s*\(([^)]*)\)\s*$/);
  if (tailParen && tailParen.index && tailParen.index > 0) {
    notes.push(tailParen[1].trim());
    text = text.slice(0, tailParen.index).trim();
  }
  const comma = text.indexOf(',');
  if (comma > 0) {
    notes.unshift(text.slice(comma + 1).trim());
    text = text.slice(0, comma).trim();
  }

  if (servingNote) notes.push(servingNote);
  const ingredient: ParsedIngredient = {
    group: null,
    quantity,
    unit,
    name: text || raw,
    note: notes.filter(Boolean).join(', ') || null,
    raw,
  };
  if (quantityMin !== undefined) ingredient.quantityMin = quantityMin;
  if (unitTyped && unit) {
    ingredient.unitTyped = unitTyped;
    if (unitFactor !== 1) ingredient.unitFactor = unitFactor;
  }
  if (optional) ingredient.optional = true;
  return { kind: 'ingredient', ingredient };
}

/** Parse a whole textarea: one ingredient per line, "Header:" lines set the group of the
 *  lines below them. */
export function parseIngredientText(text: string): ParsedIngredient[] {
  const out: ParsedIngredient[] = [];
  let group: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseIngredientLine(line);
    if (!parsed) continue;
    if (parsed.kind === 'group') {
      group = parsed.group;
    } else {
      out.push({ ...parsed.ingredient, group });
    }
  }
  return out;
}

const NICE_FRACTIONS: [number, string][] = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾']];

/** 1.5 -> "1½", 0.333 -> "⅓", 2 -> "2", 1.15 -> "1.2"; big numbers are rounded. */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return '';
  if (value >= 100) return String(Math.round(value));
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  for (const [f, glyph] of NICE_FRACTIONS) {
    if (Math.abs(frac - f) <= 0.04) return whole ? `${whole}${glyph}` : glyph;
  }
  return (Math.round(value * 10) / 10).toString();
}

/** The leading quantity of a line and the text right after it ("2 tab" -> 2, "tab"), or null when
 *  the line does not start with one. Used by the editor to tell "typing a unit" from "typing a name". */
export function leadingQuantity(line: string): { quantity: number; rest: string } | null {
  const text = prepare(line.trim()).replace(/^[-*•·▪◦]\s*/, '').trim();
  const q = readQuantity(text);
  return q ? { quantity: q.value, rest: q.rest } : null;
}
